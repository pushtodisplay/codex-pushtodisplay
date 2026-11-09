#!/usr/bin/env node
/**
 * Codex hook entry point.
 *
 * Reads the event JSON on stdin, updates the per-session state file, and either
 * spawns a detached drainer (the fast path for every ordinary event) or drains
 * synchronously (Stop, SessionEnd, and Interrupt, so the result and closing
 * line are not lost when the process exits).
 *
 * Usage:
 *   node hooks/hook.mjs            # hook mode: event JSON on stdin
 *   node hooks/hook.mjs --drain <state.json>
 *
 * This script never writes to stdout: Codex treats plain text from Stop and
 * SubagentStop as invalid output.
 */
import { spawn } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AUTH_PROBE_INTERVAL_MS,
  MAX_PENDING,
  loadConfig,
} from "../lib/config.mjs";
import { authAllowed, revokeAuth } from "../lib/auth-gate.mjs";
import {
  isAuthFailure,
  isCliMissing,
  probeAuth,
  sendPayload,
} from "../lib/cli-adapter.mjs";
import { handleEvent } from "../lib/events.mjs";
import { enqueue } from "../lib/sender.mjs";
import {
  acquireLock,
  drainLockFile,
  loadState,
  saveState,
  stateFile,
  withStateLock,
} from "../lib/state.mjs";

const HOOK_PATH = fileURLToPath(import.meta.url);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Read all of stdin as UTF-8. */
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Spawn a detached drainer. It survives this hook process, so the hook can
 * exit quickly without dropping the queue.
 */
function spawnDrainer(statePath) {
  const child = spawn(process.execPath, [HOOK_PATH, "--drain", statePath], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  // The hook must never crash because a background drainer could not start.
  child.on("error", () => {});
  child.unref();
}

/** Load state from an explicit path (the drainer has no event/session id). */
async function loadStateFromPath(statePath) {
  const sessionId =
    statePath
      .split(/[\\/]/)
      .pop()
      ?.replace(/\.json$/, "") ?? "unknown";
  return loadState(sessionId, { sessionId, agent: "codex", cwd: process.cwd() });
}

/**
 * Drain a session's queue in order, at the configured spacing.
 *
 * @param {string} statePath
 * @param {{deadlineMs: number, lockTimeoutMs?: number, spawnOnLockTimeout?: boolean}} opts
 */
async function drain(statePath, opts) {
  const deadlineMs = opts.deadlineMs;
  const lockTimeoutMs = opts.lockTimeoutMs ?? 5000;
  const started = Date.now();
  /** @type {(() => Promise<void>)|null} */
  let release = null;

  try {
    release = await acquireLock(drainLockFile(statePath), {
      // Stop may need to wait behind a slow CLI call; SessionEnd cannot.
      timeoutMs: Math.min(deadlineMs, lockTimeoutMs),
      staleMs: 120_000,
    });
  } catch {
    // Another drainer owns the queue. A hook waiting for the flush may want a
    // replacement queued; a drainer itself must not spawn a chain of them.
    if (opts.spawnOnLockTimeout !== false) spawnDrainer(statePath);
    return;
  }

  const config = loadConfig();
  let authChecked = false;

  try {
    for (;;) {
      /** @type {import("../lib/panel-state.mjs").QueueEntry|null} */
      let entry = null;
      let lastSentAt = 0;

      await withStateLock(statePath, async () => {
        const state = await loadStateFromPath(statePath);
        entry = state.queue[0] ?? null;
        lastSentAt = state.lastSentAt;
      });

      if (!entry) break;

      if (!authChecked) {
        const ok = await authAllowed({
          env: process.env,
          probe: async () => (await probeAuth()).ok,
          intervalMs: AUTH_PROBE_INTERVAL_MS,
        });
        if (!ok) {
          await withStateLock(statePath, async () => {
            const state = await loadStateFromPath(statePath);
            state.queue = [];
            state.lastError = "not authenticated";
            state.updatedAt = Date.now();
            await saveState(state);
          });
          break;
        }
        authChecked = true;
      }

      const wait = Math.max(0, config.minIntervalMs - (Date.now() - lastSentAt));
      if (Date.now() + wait > started + deadlineMs) break;
      if (wait > 0) await sleep(wait);

      /** @type {import("../lib/payloads.mjs").Payload|null} */
      let payload = null;
      await withStateLock(statePath, async () => {
        const state = await loadStateFromPath(statePath);
        const first = state.queue.shift();
        payload = first ? first.payload : null;
        state.updatedAt = Date.now();
        await saveState(state);
      });
      if (!payload) continue;

      try {
        await sendPayload(payload, config.boardId);
        await withStateLock(statePath, async () => {
          const state = await loadStateFromPath(statePath);
          state.lastSentAt = Date.now();
          state.lastError = "";
          state.updatedAt = Date.now();
          await saveState(state);
        });
      } catch (err) {
        if (isAuthFailure(err)) {
          await revokeAuth(process.env);
          await withStateLock(statePath, async () => {
            const state = await loadStateFromPath(statePath);
            state.queue = [];
            state.lastError = "not authenticated";
            state.updatedAt = Date.now();
            await saveState(state);
          });
          break;
        }
        if (isCliMissing(err)) {
          await withStateLock(statePath, async () => {
            const state = await loadStateFromPath(statePath);
            state.queue = [];
            state.lastError = "pushtodisplay CLI not found";
            state.updatedAt = Date.now();
            await saveState(state);
          });
          break;
        }
        // Transient/network failure: drop the entry, keep the trail moving.
        await withStateLock(statePath, async () => {
          const state = await loadStateFromPath(statePath);
          state.lastError = String(/** @type {Error} */ (err)?.message ?? err).slice(
            0,
            2000,
          );
          state.updatedAt = Date.now();
          await saveState(state);
        });
      }
    }
  } finally {
    if (release) await release();
  }

  // A deadline can leave entries behind (notably SessionEnd's tight budget).
  // A detached drainer finishes the job without keeping the hook alive.
  let remaining = false;
  try {
    await withStateLock(statePath, async () => {
      const state = await loadStateFromPath(statePath);
      remaining = state.queue.length > 0;
    });
  } catch {
    // Best effort.
  }
  if (remaining) spawnDrainer(statePath);
}

async function main() {
  const [first, second] = process.argv.slice(2);
  if (first === "--drain" && second) {
    await drain(second, { deadlineMs: 120_000, spawnOnLockTimeout: false });
    return;
  }

  const raw = await readStdin();
  if (!raw.trim()) return;

  /** @type {Record<string, unknown>} */
  let event;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;
    event = parsed;
  } catch {
    return;
  }

  const config = loadConfig();
  if (config.disabled) return;

  const sessionId =
    typeof event.session_id === "string" && event.session_id
      ? event.session_id
      : "unknown";
  const cwd =
    typeof event.cwd === "string" && event.cwd ? event.cwd : process.cwd();
  const statePath = stateFile(sessionId);
  const type =
    typeof event.hook_event_name === "string" ? event.hook_event_name : "";

  let queueLength = 0;
  try {
    await withStateLock(
      statePath,
      async () => {
        const state = await loadState(sessionId, {
          sessionId,
          agent: config.label.trim() || cwd.split(/[\\/]/).pop() || "codex",
          cwd,
        });
        const result = handleEvent(event, state, config);
        for (const action of result.actions) {
          enqueue(state, action.payload, {
            urgent: action.urgent,
            maxPending: MAX_PENDING,
          });
        }
        state.updatedAt = Date.now();
        await saveState(state);
        queueLength = state.queue.length;
      },
      { timeoutMs: type === "SessionEnd" ? 500 : 3000 },
    );
  } catch {
    // A hook must never break the session because its cache directory is
    // unwritable; failing closed (no line) is the right trade.
    return;
  }

  if (type === "Stop") {
    // Stop has a generous timeout; wait for every queued line, including DONE.
    spawnDrainer(statePath);
    await drain(statePath, { deadlineMs: 120_000, lockTimeoutMs: 30_000 });
  } else if (type === "SessionEnd") {
    // SessionEnd has at most a 3 s budget. Try a quick synchronous flush and
    // leave a detached drainer as the safety net.
    spawnDrainer(statePath);
    await drain(statePath, { deadlineMs: 1800, lockTimeoutMs: 1800 });
  } else if (type === "Interrupt") {
    // Interrupt has at most a 3 s budget.
    spawnDrainer(statePath);
    await drain(statePath, { deadlineMs: 1800, lockTimeoutMs: 1800 });
  } else if (queueLength > 0) {
    // Always spawn: a waiting drainer that finds the queue empty is cheap, and
    // this closes the race where an active drainer exits just after enqueue.
    spawnDrainer(statePath);
  }
}

// Exported for the integration tests, which import this file without running it.
export { drain, main };

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch(() => {
    // Hooks must exit 0: a failed mirror must never block Codex.
  });
}
