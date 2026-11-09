/**
 * The one queue between an event and the board.
 *
 * A panel is a scrolling history, so entries are a trail: they must be sent in
 * the order they happened, and a result must never be buried behind a pile of
 * steps. Sends are also rate-limited — every call costs a message from the
 * monthly quota and Sandbox tiers cap around 1 msg/s.
 *
 * The on-disk queue (`enqueue`/`trimQueue`) and the in-process `Sender` share
 * the same rules:
 *
 *  - **Order is the information.** Nothing is ever reordered.
 *  - **Bounded backlog.** Past `maxPending`, the oldest non-urgent entry is
 *    dropped: a trail that lags minutes behind the agent is worse than a
 *    shorter one.
 *  - **Consecutive duplicates are suppressed** at enqueue time, so `A, B, A`
 *    still posts both `A`s.
 *  - **Spacing is measured from the end of the previous send**, which is the
 *    conservative reading of "1 msg/s" (a slow CLI cannot compress the gap).
 */

/**
 * @typedef {import("./payloads.mjs").Payload} Payload
 * @typedef {import("./panel-state.mjs").PanelState} PanelState
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Fingerprint of what a person would actually see. */
export function fingerprint(p) {
  return JSON.stringify([
    p.background ?? "",
    p.blocks.map((b) => [b.text, b.color ?? ""]),
  ]);
}

/**
 * Add an entry to a persistent queue.
 *
 * @param {PanelState} state
 * @param {Payload} payload
 * @param {{urgent?: boolean, maxPending?: number}} [opts]
 * @returns {boolean} true when the entry was queued
 */
export function enqueue(state, payload, opts = {}) {
  const key = fingerprint(payload);
  if (key === state.lastKey) return false;
  state.lastKey = key;

  state.queue.push({
    payload,
    urgent: Boolean(opts.urgent),
    createdAt: Date.now(),
  });

  trimQueue(state, opts.maxPending ?? 25);
  state.updatedAt = Date.now();
  return true;
}

/** Drop the oldest non-urgent entries while the backlog is too long. */
export function trimQueue(state, maxPending) {
  while (state.queue.length > maxPending) {
    const victim = state.queue.findIndex((entry) => !entry.urgent);
    if (victim === -1) break;
    state.queue.splice(victim, 1);
  }
}

/**
 * In-process ordered, deduped, rate-limited sender. The hook runtime uses the
 * persistent queue instead, but this is the same policy and is exercised by
 * the unit tests.
 */
export class Sender {
  /**
   * @param {(payload: Payload) => Promise<void>} send
   * @param {number} intervalMs
   * @param {number} maxPending
   * @param {(err: unknown) => void} [onError]
   */
  constructor(send, intervalMs, maxPending, onError = () => {}) {
    this.send = send;
    this.intervalMs = intervalMs;
    this.maxPending = maxPending;
    this.onError = onError;
    /** @type {{payload: Payload, urgent: boolean}[]} */
    this.queue = [];
    /** @type {Promise<void>|null} */
    this.draining = null;
    this.lastSentAt = 0;
    this.lastKey = "";
  }

  /**
   * @param {Payload} payload
   * @param {{urgent?: boolean}} [opts]
   */
  enqueue(payload, opts = {}) {
    const key = fingerprint(payload);
    if (key === this.lastKey) return;
    this.lastKey = key;

    this.queue.push({ payload, urgent: Boolean(opts.urgent) });

    while (this.queue.length > this.maxPending) {
      const victim = this.queue.findIndex((entry) => !entry.urgent);
      if (victim === -1) break;
      this.queue.splice(victim, 1);
    }
    this.start();
  }

  /** Resolve once everything queued so far has been attempted. */
  async flush() {
    for (;;) {
      if (this.queue.length > 0 && !this.draining) this.start();
      if (!this.draining) return;
      await this.draining;
    }
  }

  start() {
    if (this.draining) return;
    this.draining = (async () => {
      try {
        for (let entry = this.queue.shift(); entry; entry = this.queue.shift()) {
          const wait = Math.max(0, this.intervalMs - (Date.now() - this.lastSentAt));
          if (wait > 0) await sleep(wait);
          try {
            await this.send(entry.payload);
          } catch (err) {
            this.onError(err);
          } finally {
            this.lastSentAt = Date.now();
          }
        }
      } finally {
        this.draining = null;
      }
    })();
  }
}
