// @ts-check
/**
 * Auth gating for outgoing messages.
 *
 * The rule is "never send while logged out", but the first seconds of a
 * session are exactly when a fast turn reports: auth has not been checked
 * *yet*, and a naive `if (!authed) return` silently discards the task and
 * result lines. So the states are distinct:
 *
 *   unknown   -> wait for the probe, then send
 *   authed    -> send
 *   known-bad -> don't send; re-probe lazily at most once per interval
 *
 * A successful login writes a small global auth hint, so a session whose last
 * probe failed notices the login immediately rather than waiting for its own
 * 20-second retry window.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { stateDir } from "./session-state.mjs";

/** @typedef {import("./session-state.mjs").AuthState} AuthState */

export const PROBE_INTERVAL_MS = 20_000;

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function authCachePath(env = process.env) {
  return path.join(stateDir(env), "auth.json");
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {AuthState | null}
 */
export function loadGlobalAuth(env = process.env) {
  try {
    const parsed = JSON.parse(fs.readFileSync(authCachePath(env), "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    return { ok: Boolean(parsed.ok), at: Number(parsed.at) || 0 };
  } catch {
    return null;
  }
}

/**
 * Record a successful login/probe for every session on this machine.
 * @param {boolean} ok
 * @param {NodeJS.ProcessEnv} [env]
 */
export function saveGlobalAuth(ok, env = process.env) {
  try {
    const dir = stateDir(env);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(authCachePath(env), JSON.stringify({ ok, at: Date.now() }), {
      mode: 0o600,
    });
  } catch {
    // Best effort; the per-session probe is still authoritative.
  }
}

/**
 * Copy a newer successful global hint into the session state.
 * @param {{ auth: AuthState | null }} state
 * @param {NodeJS.ProcessEnv} [env]
 */
export function adoptGlobalAuth(state, env = process.env) {
  const global = loadGlobalAuth(env);
  if (!global?.ok) return;
  if (!state.auth || global.at > state.auth.at) state.auth = global;
}

/**
 * @typedef {object} AuthOpts
 * @property {() => Promise<boolean>} probe
 * @property {() => number} [now]
 * @property {number} [intervalMs]
 * @property {boolean} [force] Probe even when the last answer was good.
 * @property {NodeJS.ProcessEnv} [env]
 */

/**
 * Decide whether a send is allowed, probing when the answer is unknown or the
 * known-bad answer is older than the retry interval.
 * @param {{ auth: AuthState | null }} state
 * @param {AuthOpts} opts
 * @returns {Promise<boolean>}
 */
export async function ensureAuth(state, opts) {
  const now = opts.now ?? Date.now;
  const intervalMs = opts.intervalMs ?? PROBE_INTERVAL_MS;
  adoptGlobalAuth(state, opts.env);

  if (!opts.force) {
    if (state.auth?.ok) return true;
    if (state.auth && !state.auth.ok && now() - state.auth.at < intervalMs) return false;
  }

  let ok = false;
  try {
    ok = await opts.probe();
  } catch {
    ok = false;
  }
  state.auth = { ok, at: now() };
  if (ok) saveGlobalAuth(true, opts.env);
  return ok;
}
