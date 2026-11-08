// @ts-check
import assert from "node:assert/strict";
import test from "node:test";

import {
  blockedMessage,
  clearedMessage,
  doneMessage,
  errorMessage,
  sessionClosedMessage,
  sessionOpenedMessage,
  shortenProse,
  stepMessage,
  stoppedMessage,
  taskMessage,
  testMessage,
} from "../lib/messages.mjs";
import { ACCENT, STATUS_COLOR, SURFACE, TEXT, TEXT_DIM } from "../lib/payloads.mjs";

const WALL = "11:04:22";
const AGENT = "release";

/** @param {import("../lib/payloads.mjs").Payload} payload */
const text = (payload) => payload.blocks.map((block) => block.text).join("");

const build = {
  opened: sessionOpenedMessage({ panelId: 1, agent: AGENT, wall: WALL }),
  closed: sessionClosedMessage({ panelId: 1, agent: AGENT, wall: WALL }),
  task: taskMessage({ panelId: 1, agent: AGENT, wall: WALL, task: "fix the flaky test" }),
  stepOk: stepMessage({
    panelId: 1,
    agent: AGENT,
    wall: WALL,
    toolName: "Bash",
    args: { command: "npm test" },
    cwd: "/repo",
    ok: true,
  }),
  stepFailed: stepMessage({
    panelId: 1,
    agent: AGENT,
    wall: WALL,
    toolName: "Bash",
    args: { command: "npm test" },
    cwd: "/repo",
    ok: false,
  }),
  done: doneMessage({
    panelId: 1,
    agent: AGENT,
    wall: WALL,
    text: "Pinned the clock so the release test is deterministic. No other changes.",
  }),
  blocked: blockedMessage({
    panelId: 1,
    agent: AGENT,
    wall: WALL,
    kind: "confirm",
    title: "Allow bash: git push",
  }),
  stopped: stoppedMessage({ panelId: 1, agent: AGENT, wall: WALL }),
  error: errorMessage({
    panelId: 1,
    agent: AGENT,
    wall: WALL,
    detail: "provider returned 500",
  }),
  test: testMessage({ panelId: 1, agent: AGENT, wall: WALL }),
  cleared: clearedMessage({ panelId: 1, agent: AGENT, wall: WALL }),
};

test("every message has one shape: agent, event, STATUS, HH:MM", () => {
  for (const payload of Object.values(build)) {
    const shown = text(payload);
    assert.ok(shown.startsWith(`${AGENT} `));
    assert.match(shown, / [A-Z]+ 11:04$/);
    assert.equal(payload.blocks.length, 4);
    assert.equal(payload.background, SURFACE);
    assert.equal(payload.density, "compact");
    assert.ok(!/[🎯▸◐✓✕🏁✅◌•·]/u.test(shown));
    for (const block of payload.blocks) {
      assert.deepEqual(Object.keys(block).sort(), ["color", "text"]);
    }
  }
});

test("name, body, status and time are coloured apart", () => {
  const statusColors = new Set(Object.values(STATUS_COLOR));
  for (const payload of Object.values(build)) {
    const [agent, body, status, time] = payload.blocks;
    assert.equal(agent.color, ACCENT);
    assert.equal(body.color, TEXT);
    assert.ok(statusColors.has(status.color ?? ""));
    assert.equal(time.color, TEXT_DIM);
  }
});

test("the closed status vocabulary is the only one used", () => {
  const allowed = ["READY", "RUN", "OK", "FAIL", "NEEDS", "DONE", "STOP", "ENDED"];
  for (const payload of Object.values(build)) {
    assert.ok(allowed.some((word) => text(payload).includes(` ${word} `)));
  }
});

test("exact lifecycle and event lines", () => {
  assert.equal(text(build.opened), "release session opened READY 11:04");
  assert.equal(text(build.closed), "release session closed ENDED 11:04");
  assert.equal(text(build.task), "release fix the flaky test RUN 11:04");
  assert.equal(text(build.stepOk), "release running npm test OK 11:04");
  assert.equal(text(build.stepFailed), "release running npm test FAIL 11:04");
  assert.equal(text(build.blocked), "release Allow bash: git push NEEDS 11:04");
  assert.equal(text(build.stopped), "release interrupted before it finished STOP 11:04");
  assert.equal(text(build.error), "release provider returned 500 FAIL 11:04");
  assert.equal(text(build.test), "release link OK, panel 1 OK 11:04");
  assert.equal(text(build.cleared), "release log cleared OK 11:04");
});

test("DONE quotes the agent, shortening to the first sentence", () => {
  assert.equal(
    text(build.done),
    "release Pinned the clock so the release test is deterministic. DONE 11:04",
  );
  assert.equal(
    text(doneMessage({ panelId: 1, agent: AGENT, wall: WALL, text: "  " })),
    "release no summary DONE 11:04",
  );
});

test("long prompts and results are capped at 60 characters", () => {
  const prompt =
    "Refactor the auth middleware so that every request resolves its session once, " +
    "and add a regression test for the double-resolve bug we saw in production. " +
    "Then tell me what changed.";
  const payload = taskMessage({ panelId: 1, agent: "codex", wall: WALL, task: prompt });
  const body = payload.blocks[1]?.text.trim() ?? "";
  assert.ok(body.length <= 60);
  assert.ok(body.startsWith("Refactor the auth middleware"));
  assert.ok(body.endsWith("…"));
  assert.ok(!text(payload).includes("Then tell me what changed"));
});

test("a multi-line provider error stays one line", () => {
  const payload = errorMessage({
    panelId: 1,
    agent: AGENT,
    wall: WALL,
    detail: "HTTP 500\n  upstream\ttimed out",
  });
  assert.equal(text(payload), "release HTTP 500 upstream timed out FAIL 11:04");
});

test("prose shortening keeps short sentences whole", () => {
  assert.equal(shortenProse("Run the tests. Then summarise."), "Run the tests.");
  assert.equal(shortenProse(""), "");
});
