// @ts-check
/**
 * Per-session state on disk.
 *
 * Codex runs each hook as a separate process, so the queue, the last send
 * time, the task, and the last assistant text have to survive between
 * invocations. They live in:
 *
 *   ~/.cache/pushtodisplay/codex/<session_id>.json
 *
 * A lock directory serializes concurrent hooks for the same session. The lock
 * is deliberately simple (mkdir is atomic on every platform we support) and
 * stale locks are reclaimed after 30 seconds.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

import { cacheDir } from "./config.mjs";

/** @typedef {import("./queue.mjs").QueueEntry} QueueEntry */

/**
 * @typedef {object} AuthState
 * @property {boolean} ok
 * @property {number} at Epoch milliseconds of the probe.
 */

/**
 * @typedef {object} SessionState
 * @property {number} version
 * @property {string} sessionId
 * @property {string} cwd
 * @property {string} label
 * @property {string} task
 * @property {string} lastAssistant
 * @property {QueueEntry[]} queue
 * @property {string} lastKey
 * @property {number} lastSentAt
 * @property {AuthState | null} auth
 */

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Make a session id safe for a file name without losing its identity.
 * @param {string} sessionId
 * @returns {string}
 */
export function safeSessionId(sessionId) {
  const raw = String(sessionId ?? "") || "unknown";
  const safe = raw.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 96);
  if (safe === raw) return safe;
  const hash = createHash("sha256").update(raw).digest("hex").slice(0, 8);
  return `${safe}-${hash}`;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function stateDir(env = process.env) {
  return cacheDir(env);
}

/**
 * @param {string} sessionId
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function statePath(sessionId, env = process.env) {
  return path.join(stateDir(env), `${safeSessionId(sessionId)}.json`);
}

/**
 * @param {{ sessionId: string, cwd?: string, label?: string }} opts
 * @returns {SessionState}
 */
export function createState(opts) {
  return {
    version: 1,
    sessionId: opts.sessionId,
    cwd: opts.cwd ?? process.cwd(),
    label: opts.label ?? "",
    task: "",
    lastAssistant: "",
    queue: [],
    lastKey: "",
    lastSentAt: 0,
    auth: null,
  };
}

/**
 * @param {string} sessionId
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {SessionState | null}
 */
export function loadState(sessionId, env = process.env) {
  try {
    const contents = fs.readFileSync(statePath(sessionId, env), "utf8");
    const parsed = JSON.parse(contents);
    if (!parsed || typeof parsed !== "object") return null;
    const queue = /** @type {QueueEntry[]} */ (
      Array.isArray(parsed.queue) ? parsed.queue : []
    );
    return {
      version: 1,
      sessionId: String(parsed.sessionId ?? sessionId),
      cwd: String(parsed.cwd ?? ""),
      label: String(parsed.label ?? ""),
      task: String(parsed.task ?? ""),
      lastAssistant: String(parsed.lastAssistant ?? ""),
      queue: queue.filter(
        (entry) =>
          entry &&
          typeof entry === "object" &&
          entry.payload &&
          Array.isArray(entry.payload.blocks),
      ),
      lastKey: String(parsed.lastKey ?? ""),
      lastSentAt: Number(parsed.lastSentAt) || 0,
      auth:
        parsed.auth && typeof parsed.auth === "object"
          ? { ok: Boolean(parsed.auth.ok), at: Number(parsed.auth.at) || 0 }
          : null,
    };
  } catch {
    return null;
  }
}

/**
 * @param {SessionState} state
 * @param {NodeJS.ProcessEnv} [env]
 */
export function saveState(state, env = process.env) {
  const dir = stateDir(env);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const target = statePath(state.sessionId, env);
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
  fs.renameSync(temp, target);
}

/**
 * @param {string} sessionId
 * @param {NodeJS.ProcessEnv} [env]
 */
export function deleteState(sessionId, env = process.env) {
  try {
    fs.rmSync(statePath(sessionId, env), { force: true });
  } catch {
    // A missing state file is the desired end state.
  }
}

/**
 * @typedef {object} LockOpts
 * @property {number} [waitMs] How long to wait for an existing lock.
 * @property {number} [staleMs] When a lock may be reclaimed.
 * @property {NodeJS.ProcessEnv} [env]
 */

/**
 * Run `fn` while holding the per-session lock. Lock failures are not fatal:
 * after `waitMs` the callback runs anyway, because a board update is better
 * than a permanently wedged hook.
 * @template T
 * @param {string} sessionId
 * @param {() => T | Promise<T>} fn
 * @param {LockOpts} [opts]
 * @returns {Promise<T>}
 */
export async function withLock(sessionId, fn, opts = {}) {
  const waitMs = opts.waitMs ?? 8000;
  const staleMs = opts.staleMs ?? 30_000;
  const env = opts.env ?? process.env;
  const dir = stateDir(env);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lockPath = `${statePath(sessionId, env)}.lock`;
  const started = Date.now();
  let acquired = false;

  while (Date.now() - started <= waitMs) {
    try {
      fs.mkdirSync(lockPath);
      acquired = true;
      break;
    } catch (error) {
      const code = /** @type {NodeJS.ErrnoException} */ (error).code;
      if (code !== "EEXIST") break;
      try {
        const stat = fs.statSync(lockPath);
        if (Date.now() - stat.mtimeMs > staleMs) {
          fs.rmSync(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }
      await sleep(40);
    }
  }

  try {
    return await fn();
  } finally {
    if (acquired) {
      try {
        fs.rmSync(lockPath, { recursive: true, force: true });
      } catch {
        // Releasing is best-effort; the stale reclaim handles a crash.
      }
    }
  }
}
