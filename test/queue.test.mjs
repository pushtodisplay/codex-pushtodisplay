// @ts-check
import assert from "node:assert/strict";
import test from "node:test";

import { drain, enqueue, fingerprint } from "../lib/queue.mjs";

/** @param {string} value */
const msg = (value) => ({ panelId: 1, blocks: [{ text: value }] });
const ignore = () => {};
const NO_INTERVAL = 0;
const NO_BOUND = 1000;

/** @returns {{ queue: import("../lib/queue.mjs").QueueEntry[], lastKey: string, lastSentAt: number }} */
const state = () => ({ queue: [], lastKey: "", lastSentAt: 0 });

/** A recorder plus a fake clock whose sleep advances time. */
function fakeClock() {
  let time = 1000;
  /** @type {number[]} */
  const sleeps = [];
  return {
    now: () => time,
    sleep: async (ms) => {
      sleeps.push(ms);
      time += ms;
    },
    get sleeps() {
      return sleeps;
    },
  };
}

test("entries are sent in the order they happened", async () => {
  /** @type {string[]} */
  const sent = [];
  const s = state();
  enqueue(s, msg("a"), { maxPending: NO_BOUND });
  enqueue(s, msg("b"), { maxPending: NO_BOUND });
  enqueue(s, msg("c"), { maxPending: NO_BOUND });
  await drain(
    s,
    async (payload) => {
      sent.push(String(payload.blocks[0]?.text));
    },
    { intervalMs: NO_INTERVAL, onError: ignore },
  );
  assert.deepEqual(sent, ["a", "b", "c"]);
});

test("consecutive duplicates are suppressed, but A, B, A posts both As", async () => {
  /** @type {string[]} */
  const sent = [];
  const s = state();
  assert.equal(enqueue(s, msg("same")), true);
  assert.equal(enqueue(s, msg("same")), false);
  enqueue(s, msg("other"));
  enqueue(s, msg("same"));
  await drain(
    s,
    async (payload) => {
      sent.push(String(payload.blocks[0]?.text));
    },
    { intervalMs: NO_INTERVAL, onError: ignore },
  );
  assert.deepEqual(sent, ["same", "other", "same"]);
});

test("identical text from different agents is not a duplicate", () => {
  const s = state();
  enqueue(s, msg("release running npm test OK 11:04"));
  assert.equal(enqueue(s, msg("qa running npm test OK 11:04")), true);
  assert.equal(s.queue.length, 2);
});

test("the backlog drops the oldest step, never a milestone", async () => {
  /** @type {string[]} */
  const sent = [];
  const s = state();
  enqueue(s, msg("RESULT"), { urgent: true, maxPending: 3 });
  for (let i = 0; i < 10; i += 1) enqueue(s, msg(`step ${i}`), { maxPending: 3 });
  await drain(
    s,
    async (payload) => {
      sent.push(String(payload.blocks[0]?.text));
    },
    { intervalMs: NO_INTERVAL, onError: ignore },
  );
  assert.ok(sent.includes("RESULT"));
  assert.ok(!sent.includes("step 0"));
  assert.equal(sent.at(-1), "step 9");
  assert.ok(sent.length <= 4);
});

test("sends are spaced from the end of the previous send", async () => {
  const clock = fakeClock();
  /** @type {number[]} */
  const at = [];
  const s = state();
  s.lastSentAt = 1000;
  enqueue(s, msg("a"));
  enqueue(s, msg("b"));
  await drain(
    s,
    async () => {
      at.push(clock.now());
    },
    { intervalMs: 1200, now: clock.now, sleep: clock.sleep, onError: ignore },
  );
  assert.equal(at.length, 2);
  assert.ok((at[1] ?? 0) - (at[0] ?? 0) >= 1200);
  assert.deepEqual(clock.sleeps, [1200, 1200]);
});

test("a deadline leaves unsent entries queued", async () => {
  const clock = fakeClock();
  const s = state();
  enqueue(s, msg("a"));
  enqueue(s, msg("b"));
  enqueue(s, msg("c"));
  const sent = await drain(
    s,
    async () => {},
    {
      intervalMs: 1200,
      now: clock.now,
      sleep: clock.sleep,
      deadline: clock.now() + 1300,
      onError: ignore,
    },
  );
  assert.equal(sent, 1);
  assert.equal(s.queue.length, 2);
});

test("a failed send is reported and does not silently stop the queue", async () => {
  /** @type {string[]} */
  const sent = [];
  /** @type {unknown[]} */
  const errors = [];
  let calls = 0;
  const s = state();
  enqueue(s, msg("a"));
  enqueue(s, msg("b"));
  await drain(
    s,
    async (payload) => {
      calls += 1;
      if (calls === 1) throw new Error("boom");
      sent.push(String(payload.blocks[0]?.text));
    },
    { intervalMs: NO_INTERVAL, onError: (error) => errors.push(error) },
  );
  assert.deepEqual(sent, ["b"]);
  assert.equal(errors.length, 1);
});

test("shouldStop halts before the next entry", async () => {
  /** @type {string[]} */
  const sent = [];
  let stop = false;
  const s = state();
  enqueue(s, msg("a"));
  enqueue(s, msg("b"));
  await drain(
    s,
    async (payload) => {
      sent.push(String(payload.blocks[0]?.text));
      stop = true;
    },
    { intervalMs: NO_INTERVAL, shouldStop: () => stop, onError: ignore },
  );
  assert.deepEqual(sent, ["a"]);
  assert.equal(s.queue.length, 1);
});

test("fingerprint includes the visible colour and text", () => {
  assert.equal(fingerprint(msg("a")), fingerprint(msg("a")));
  assert.notEqual(fingerprint(msg("a")), fingerprint(msg("b")));
  assert.notEqual(
    fingerprint({ panelId: 1, blocks: [{ text: "a", color: "#fff" }] }),
    fingerprint({ panelId: 1, blocks: [{ text: "a", color: "#000" }] }),
  );
});
