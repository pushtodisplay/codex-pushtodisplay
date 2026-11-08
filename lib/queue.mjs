// @ts-check
/**
 * The persistent queue between a hook event and the board.
 *
 * A panel is a scrolling history, so entries are a trail: they must be sent in
 * the order they happened, and a result must never be buried behind a pile of
 * steps. Every API call also costs a message from the monthly quota, and
 * Sandbox tiers cap around one message per second, so sends are spaced.
 *
 * The queue survives between hook processes (each Codex hook is a new process):
 * it lives in the per-session state file and every invocation drains whatever
 * is pending. Across processes the rules are:
 *
 *  - Order is the information. Nothing is reordered.
 *  - Bounded backlog: past `maxPending`, the oldest non-urgent entry is dropped.
 *  - Consecutive duplicates are suppressed at enqueue time, so `A, B, A` still
 *    posts both `A`s.
 *  - Spacing is measured from the end of the previous send, the conservative
 *    reading of "one message per second".
 */

/** @typedef {import("./payloads.mjs").Payload} Payload */

/**
 * @typedef {object} QueueEntry
 * @property {Payload} payload
 * @property {boolean} urgent Milestones and results survive backlog trimming; steps do not.
 */

/**
 * @typedef {object} QueueState
 * @property {QueueEntry[]} queue
 * @property {string} lastKey
 * @property {number} lastSentAt
 */

/**
 * Fingerprint of what a person would actually see. Two lines with different
 * colours are different lines; identical text from different agents is not
 * identical because the agent name is part of the first block.
 * @param {Payload} payload
 * @returns {string}
 */
export function fingerprint(payload) {
  return JSON.stringify([
    payload.background ?? "",
    payload.blocks.map((block) => [block.text, block.color ?? ""]),
  ]);
}

/**
 * Add an entry, suppressing a consecutive duplicate and trimming the backlog.
 * @param {QueueState} state
 * @param {Payload} payload
 * @param {{ urgent?: boolean, maxPending?: number }} [opts]
 * @returns {boolean} Whether the entry was accepted.
 */
export function enqueue(state, payload, opts = {}) {
  const key = fingerprint(payload);
  if (key === state.lastKey) return false;
  state.lastKey = key;
  state.queue.push({ payload, urgent: Boolean(opts.urgent) });

  const maxPending = opts.maxPending ?? 25;
  while (state.queue.length > maxPending) {
    const victim = state.queue.findIndex((entry) => !entry.urgent);
    if (victim === -1) break;
    state.queue.splice(victim, 1);
  }
  return true;
}

/** @typedef {(payload: Payload) => Promise<void>} SendFn */

/**
 * @typedef {object} DrainOpts
 * @property {number} [intervalMs] Minimum gap between sends.
 * @property {number} [maxSends] Stop after this many sends.
 * @property {number} [deadline] Absolute epoch ms after which to stop.
 * @property {() => number} [now] Clock injection for tests.
 * @property {(ms: number) => Promise<void>} [sleep] Sleep injection for tests.
 * @property {(entry: QueueEntry) => void | Promise<void>} [onSent] Called after a successful send.
 * @property {(error: unknown, entry: QueueEntry) => void} [onError] Called after a failed send.
 * @property {() => boolean} [shouldStop] Stop before the next entry when true.
 */

/**
 * Drain the queue in order, spacing sends and stopping at a deadline. Entries
 * that could not be attempted stay queued for the next hook invocation.
 * @param {QueueState} state
 * @param {SendFn} send
 * @param {DrainOpts} [opts]
 * @returns {Promise<number>} Number of entries attempted.
 */
export async function drain(state, send, opts = {}) {
  const intervalMs = opts.intervalMs ?? 1200;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const maxSends = opts.maxSends ?? Number.POSITIVE_INFINITY;
  let attempted = 0;

  while (state.queue.length > 0 && attempted < maxSends) {
    if (opts.shouldStop?.()) break;
    const entry = state.queue[0];
    if (!entry) break;
    const wait = Math.max(0, intervalMs - (now() - state.lastSentAt));
    if (opts.deadline !== undefined && now() + wait > opts.deadline) break;
    if (wait > 0) await sleep(wait);
    state.queue.shift();
    attempted += 1;
    try {
      await send(entry.payload);
      await opts.onSent?.(entry);
    } catch (error) {
      opts.onError?.(error, entry);
    } finally {
      state.lastSentAt = now();
    }
  }

  return attempted;
}
