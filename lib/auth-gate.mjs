/**
 * Auth gate for outgoing messages.
 *
 * The rule is "never send while logged out", which sounds simple until you
 * consider the first seconds of a session: auth has not been checked *yet*, and
 * a naive `if (!authed) return` silently discards everything a fast turn
 * produces.
 *
 * So the states are distinct:
 *
 *   unknown   → wait for the probe, then send
 *   authed    → send
 *   known-bad → don't send, and don't re-ask more often than `intervalMs`
 *
 * In the hook runtime each event is a new process, so the decision is cached in
 * the plugin cache directory and shared by every session.
 */
import { AUTH_PROBE_INTERVAL_MS } from "./config.mjs";
import { readAuth, writeAuth } from "./state.mjs";

/** In-process gate, kept for parity with the other Pushtodisplay plugins. */
export class AuthGate {
  /**
   * @param {() => Promise<boolean>} probe
   * @param {number} intervalMs
   * @param {() => number} [now]
   */
  constructor(probe, intervalMs, now = Date.now) {
    this.probe = probe;
    this.intervalMs = intervalMs;
    this.now = now;
    this.authed = false;
    /** @type {Promise<boolean>|null} */
    this.probing = null;
    this.lastProbeAt = 0;
  }

  get authenticated() {
    return this.authed;
  }

  /** Start a probe now. Used on session start and after login. */
  start() {
    return this.run();
  }

  /**
   * May a message go out? Resolves true when it may. While a probe is in flight
   * this waits for it rather than answering "no" — that is the whole point.
   */
  async allowed() {
    if (this.authed) return true;
    if (this.probing) return this.probing;
    if (this.now() - this.lastProbeAt >= this.intervalMs) return this.run();
    return false;
  }

  /** A send failed on auth: stop sending until a probe succeeds again. */
  revoke() {
    this.authed = false;
  }

  /** Probe again, ignoring the interval (e.g. the status skill). */
  recheck() {
    this.lastProbeAt = 0;
    return this.run();
  }

  run() {
    if (!this.probing) {
      this.lastProbeAt = this.now();
      this.probing = this.probe()
        .then((ok) => {
          this.authed = ok;
          return ok;
        })
        .finally(() => {
          this.probing = null;
        });
    }
    return this.probing;
  }
}

/**
 * Persistent gate: decide whether a send may go out, probing when the cached
 * answer is missing or old enough.
 *
 * @param {{env?: NodeJS.ProcessEnv, probe: () => Promise<boolean>, now?: () => number, intervalMs?: number, force?: boolean}} opts
 * @returns {Promise<boolean>}
 */
export async function authAllowed(opts) {
  const env = opts.env ?? process.env;
  const now = opts.now ?? Date.now;
  const intervalMs = opts.intervalMs ?? AUTH_PROBE_INTERVAL_MS;
  const cached = await readAuth(env);

  if (!opts.force && cached?.status === "ok") return true;
  if (!opts.force && cached?.status === "bad" && now() - cached.at < intervalMs) {
    return false;
  }

  let ok = false;
  try {
    ok = await opts.probe();
  } catch {
    ok = false;
  }
  await writeAuth({ status: ok ? "ok" : "bad", at: now() }, env);
  return ok;
}

/** Mark the account as known-bad after an auth failure. */
export async function revokeAuth(env = process.env, now = Date.now) {
  await writeAuth({ status: "bad", at: now() }, env);
}

/** Force a probe and refresh the cache. Used by the status skill. */
export async function recheckAuth(probe, env = process.env, now = Date.now) {
  return authAllowed({ env, probe, now, force: true });
}
