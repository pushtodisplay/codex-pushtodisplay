// @ts-check
/**
 * The transport: load the session state, apply the event, gate on auth, and
 * drain the persistent queue through the `pushtodisplay` CLI.
 *
 * Every hook invocation is a fresh process, so "the queue" is the array in the
 * session state file and "the sender" is whatever process currently holds the
 * lock. That is enough: hooks are short, sends are spaced, and the final event
 * of a turn takes the same lock to flush what earlier steps left behind.
 */
import { authStatus, isAuthFailure, isCliMissing, sendPayload } from "./cli-adapter.mjs";
import { ensureAuth } from "./auth-gate.mjs";
import { loadConfig } from "./config.mjs";
import { finalDeadlineMs, handleEvent } from "./hook-events.mjs";
import { drain, enqueue } from "./queue.mjs";
import {
  createState,
  deleteState,
  loadState,
  saveState,
  withLock,
} from "./session-state.mjs";

/** @typedef {import("./hook-events.mjs").HookEvent} HookEvent */
/** @typedef {import("./session-state.mjs").SessionState} SessionState */

/** Entries kept before the oldest non-urgent step is dropped. */
const MAX_PENDING = 25;

/**
 * @param {string} hookEventName
 * @returns {number}
 */
function deadlineFor(hookEventName) {
  const final = finalDeadlineMs(hookEventName);
  if (final) return final;
  switch (hookEventName) {
    case "PermissionRequest":
      // Approval must not wait on the board. Leave a line queued for the next
      // event if a send cannot start promptly.
      return 1500;
    case "SessionStart":
    case "UserPromptSubmit":
      return 9000;
    case "PostToolUse":
    case "PostModelRequest":
      return 30_000;
    default:
      return 5000;
  }
}

/**
 * The auth probe must fit inside the event's hook timeout. Final events have
 * the least room; an approval prompt has only a little more.
 * @param {string} hookEventName
 * @param {boolean} final
 * @returns {number}
 */
function probeTimeoutFor(hookEventName, final) {
  if (final) return hookEventName === "Stop" ? 3000 : 1200;
  if (hookEventName === "PermissionRequest") return 3000;
  return 10_000;
}

/**
 * @typedef {object} ProcessOpts
 * @property {NodeJS.ProcessEnv} [env]
 * @property {string} [pluginRoot]
 * @property {() => number} [now]
 * @property {(ms: number) => Promise<void>} [sleep]
 * @property {() => Promise<boolean>} [probe] Override the auth probe (tests).
 * @property {(payload: import("./payloads.mjs").Payload) => Promise<void>} [send] Override the transport (tests).
 */

/**
 * Apply one hook event and flush as much of the queue as the event allows.
 * Never throws for an expected failure; the caller still exits 0 so hooks do
 * not steer Codex.
 * @param {HookEvent} event
 * @param {ProcessOpts} [opts]
 * @returns {Promise<void>}
 */
export async function processHookEvent(event, opts = {}) {
  const env = opts.env ?? process.env;
  const config = loadConfig(env);
  if (config.disabled) return;

  const sessionId = event.session_id || "unknown";
  const pluginRoot = opts.pluginRoot ?? env.PLUGIN_ROOT ?? env.CLAUDE_PLUGIN_ROOT;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep;

  await withLock(
    sessionId,
    async () => {
      const state =
        loadState(sessionId, env) ??
        createState({
          sessionId,
          cwd: event.cwd,
          label: "",
        });

      const result = handleEvent(event, config, state);
      if (result.payload) {
        enqueue(state, result.payload, { urgent: result.urgent, maxPending: MAX_PENDING });
      }

      if (state.queue.length > 0) {
        const probe =
          opts.probe ??
          (() =>
            authStatus({
              env,
              pluginRoot,
              timeoutMs: probeTimeoutFor(event.hook_event_name, result.final),
            }));
        const allowed = await ensureAuth(state, {
          probe,
          now,
          force: result.forceAuth,
          env,
        });
        if (!allowed) {
          // Known-bad auth drops updates instead of buffering them: the board
          // must not receive a stale pile of steps after a long logged-out gap.
          state.queue = [];
        } else {
          let stop = false;
          const deadline = now() + deadlineFor(event.hook_event_name);
          await drain(
            state,
            opts.send ?? ((payload) => sendPayload(payload, config.boardId, { env, pluginRoot })),
            {
              intervalMs: config.intervalMs,
              deadline,
              now,
              sleep,
              onSent: () => saveState(state, env),
              onError: (error) => {
                if (isAuthFailure(error)) {
                  state.auth = { ok: false, at: now() };
                  state.queue = [];
                }
                // Stop after the first failure: the remaining entries wait for
                // the next event instead of hammering a down network.
                stop = true;
                if (isCliMissing(error)) state.queue = [];
              },
              shouldStop: () => stop,
            },
          );
        }
      }

      if (result.removeState) deleteState(sessionId, env);
      else saveState(state, env);
    },
    { env },
  );
}
