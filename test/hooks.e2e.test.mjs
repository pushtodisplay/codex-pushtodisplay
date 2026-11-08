// @ts-check
/** End-to-end: real hook process, fake CLI on PATH, real per-session state. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import * as path from "node:path";
import test from "node:test";

import { SURFACE } from "../lib/payloads.mjs";
import { createHarness, fixture } from "./helpers.mjs";

/** @param {string} text */
const opened = (text) => /^demo session opened READY \d{2}:\d{2}$/.test(text);

/**
 * @param {import("./helpers.mjs").Harness} harness
 * @param {string} sessionId
 */
function stateFile(harness, sessionId) {
  return path.join(harness.cache, `${sessionId}.json`);
}

test("SessionStart posts one READY line for startup, resume, clear, and fork", async () => {
  const harness = createHarness();
  try {
    const results = await harness.runAll([
      fixture("session-start"),
      fixture("session-start-resume"),
      fixture("session-start-clear"),
      fixture("session-start-fork"),
    ]);
    for (const result of results) {
      assert.equal(result.code, 0);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
    }
    const entries = harness.entries();
    assert.equal(entries.length, 4);
    for (const entry of entries) {
      assert.ok(opened(entry.text), entry.text);
      assert.equal(entry.panel, 1);
      assert.equal(entry.background, SURFACE);
      assert.equal(entry.density, "compact");
      assert.equal(entry.blocks.length, 4);
    }
  } finally {
    harness.cleanup();
  }
});

test("SessionStart compact is silent", async () => {
  const harness = createHarness();
  try {
    const result = await harness.run(fixture("session-start-compact"));
    assert.equal(result.code, 0);
    assert.equal(result.stdout, "");
    assert.equal(harness.entries().length, 0);
  } finally {
    harness.cleanup();
  }
});

test("UserPromptSubmit posts the task as RUN", async () => {
  const harness = createHarness();
  try {
    const result = await harness.run(fixture("user-prompt-submit"));
    assert.equal(result.code, 0);
    assert.equal(result.stdout, "");
    const [entry] = harness.entries();
    assert.match(entry?.text ?? "", /^demo Fix the flaky release test\. RUN \d{2}:\d{2}$/);
  } finally {
    harness.cleanup();
  }
});

test("a finished Bash step reports OK or FAIL from tool_response", async () => {
  const harness = createHarness();
  try {
    await harness.run(fixture("post-tool-use-bash-ok"));
    await harness.run(fixture("post-tool-use-bash-fail"));
    const entries = harness.entries();
    assert.equal(entries.length, 2);
    assert.match(entries[0]?.text ?? "", /^demo running npm test OK \d{2}:\d{2}$/);
    assert.match(entries[1]?.text ?? "", /^demo running npm test FAIL \d{2}:\d{2}$/);
  } finally {
    harness.cleanup();
  }
});

test("apply_patch names the file and carries the patch stat", async () => {
  const harness = createHarness();
  try {
    await harness.run(fixture("post-tool-use-apply-patch"));
    const [entry] = harness.entries();
    assert.match(
      entry?.text ?? "",
      /^demo editing src\/release\.ts \(\+2 −1\) OK \d{2}:\d{2}$/,
    );
  } finally {
    harness.cleanup();
  }
});

test("MCP failures are reported, and subagent tool loops stay quiet", async () => {
  const harness = createHarness();
  try {
    await harness.run(fixture("post-tool-use-mcp-fail"));
    await harness.run(fixture("post-tool-use-subagent"));
    const entries = harness.entries();
    assert.equal(entries.length, 1);
    assert.match(entries[0]?.text ?? "", /^demo using linear\.create_issue FAIL \d{2}:\d{2}$/);
  } finally {
    harness.cleanup();
  }
});

test("PermissionRequest logs NEEDS and returns no decision", async () => {
  const harness = createHarness();
  try {
    const result = await harness.run(fixture("permission-request"));
    assert.equal(result.code, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    const [entry] = harness.entries();
    assert.match(
      entry?.text ?? "",
      /^demo Allow bash: git push --force-with-lease NEEDS \d{2}:\d{2}$/,
    );
  } finally {
    harness.cleanup();
  }
});

test("Stop quotes the last assistant message; a re-entrant Stop is silent", async () => {
  const harness = createHarness();
  try {
    await harness.run(fixture("stop-active"));
    assert.equal(harness.entries().length, 0);
    await harness.run(fixture("stop"));
    const [entry] = harness.entries();
    assert.match(
      entry?.text ?? "",
      /^demo Pinned the clock so the release test passes\. DONE \d{2}:\d{2}$/,
    );
  } finally {
    harness.cleanup();
  }
});

test("Interrupt posts STOP and SessionEnd posts ENDED, then removes state", async () => {
  const harness = createHarness();
  try {
    await harness.run(fixture("interrupt"));
    await harness.run(fixture("session-end"));
    const entries = harness.entries();
    assert.equal(entries.length, 2);
    assert.match(entries[0]?.text ?? "", /^demo interrupted before it finished STOP \d{2}:\d{2}$/);
    assert.match(entries[1]?.text ?? "", /^demo session closed ENDED \d{2}:\d{2}$/);
    assert.equal(harness.stateExists("sess-end"), false);
  } finally {
    harness.cleanup();
  }
});

test("PostModelRequest reports only failed attempts", async () => {
  const harness = createHarness();
  try {
    await harness.run(fixture("post-model-request-completed"));
    assert.equal(harness.entries().length, 0);
    await harness.run(fixture("post-model-request-failed"));
    const [entry] = harness.entries();
    assert.match(entry?.text ?? "", /^demo HTTP 500 from provider FAIL \d{2}:\d{2}$/);
  } finally {
    harness.cleanup();
  }
});

test("a full turn preserves order: READY, RUN, OK, DONE", async () => {
  const harness = createHarness();
  try {
    const session = "sess-turn";
    await harness.runAll(
      [
        fixture("session-start"),
        fixture("user-prompt-submit"),
        fixture("post-tool-use-bash-ok"),
        fixture("stop"),
      ].map((event) => ({ ...event, session_id: session })),
    );
    const texts = harness.entries().map((entry) => entry.text);
    assert.equal(texts.length, 4);
    assert.match(texts[0] ?? "", /^demo session opened READY /);
    assert.match(texts[1] ?? "", /^demo Fix the flaky release test\. RUN /);
    assert.match(texts[2] ?? "", /^demo running npm test OK /);
    assert.match(texts[3] ?? "", /^demo Pinned the clock so the release test passes\. DONE /);
  } finally {
    harness.cleanup();
  }
});

test("consecutive duplicate lines are suppressed across hook processes", async () => {
  const harness = createHarness();
  try {
    const event = { ...fixture("post-tool-use-bash-ok"), session_id: "sess-dedupe" };
    await harness.run(event);
    await harness.run(event);
    assert.equal(harness.entries().length, 1);
  } finally {
    harness.cleanup();
  }
});

test("sends are spaced at least 1.2 seconds apart by default", async () => {
  const harness = createHarness({ intervalMs: 1200 });
  try {
    const session = "sess-spacing";
    await harness.runAll(
      [fixture("session-start"), fixture("user-prompt-submit")].map((event) => ({
        ...event,
        session_id: session,
      })),
    );
    const entries = harness.entries();
    assert.equal(entries.length, 2);
    assert.ok((entries[1]?.at ?? 0) - (entries[0]?.at ?? 0) >= 1100);
  } finally {
    harness.cleanup();
  }
});

test("PUSHTODISPLAY_DISABLED=1 does nothing at all", async () => {
  const harness = createHarness();
  try {
    const result = await harness.run(fixture("session-start"), {
      PUSHTODISPLAY_DISABLED: "1",
    });
    assert.equal(result.code, 0);
    assert.equal(result.stdout, "");
    assert.equal(harness.entries().length, 0);
    assert.equal(harness.stateExists("sess-startup"), false);
  } finally {
    harness.cleanup();
  }
});

test("PUSHTODISPLAY_STEPS=0 keeps milestones but drops tool steps", async () => {
  const harness = createHarness();
  try {
    await harness.run(fixture("session-start"), { PUSHTODISPLAY_STEPS: "0" });
    await harness.run(fixture("post-tool-use-bash-ok"), { PUSHTODISPLAY_STEPS: "0" });
    const entries = harness.entries();
    assert.equal(entries.length, 1);
    assert.ok(opened(entries[0]?.text ?? ""));
  } finally {
    harness.cleanup();
  }
});

test("label, panel, and board come from the environment", async () => {
  const harness = createHarness();
  try {
    await harness.run(fixture("session-start"), {
      PUSHTODISPLAY_LABEL: "cicd",
      PUSHTODISPLAY_PANEL: "3",
      PUSHTODISPLAY_BOARD_ID: "board-42",
    });
    const [entry] = harness.entries();
    assert.match(entry?.text ?? "", /^cicd session opened READY \d{2}:\d{2}$/);
    assert.equal(entry?.panel, 3);
    assert.equal(entry?.boardId, "board-42");
  } finally {
    harness.cleanup();
  }
});

test("known-bad auth drops updates; a stale answer re-probes after login", async () => {
  const harness = createHarness({ auth: false });
  try {
    const session = "sess-auth";
    const start = fixture("session-start");
    await harness.run({ ...start, session_id: session });
    assert.equal(harness.entries().length, 0);
    assert.ok(harness.stateExists(session));

    const state = harness.readState(session);
    const auth = /** @type {{ ok: boolean, at: number }} */ (state.auth);
    auth.at = Date.now() - 21_000;
    writeFileSync(stateFile(harness, session), JSON.stringify(state));

    await harness.run({ ...fixture("user-prompt-submit"), session_id: session }, {
      FAKE_PTD_AUTH: "1",
    });
    assert.equal(harness.entries().length, 1);
    assert.match(harness.entries()[0]?.text ?? "", /^demo Fix the flaky release test\. RUN /);
  } finally {
    harness.cleanup();
  }
});

test("a successful login hint re-enables sending without waiting for the retry window", async () => {
  const harness = createHarness({ auth: false });
  try {
    const session = "sess-login";
    await harness.run({ ...fixture("session-start"), session_id: session });
    assert.equal(harness.entries().length, 0);
    writeFileSync(
      path.join(harness.cache, "auth.json"),
      JSON.stringify({ ok: true, at: Date.now() }),
    );
    await harness.run({ ...fixture("user-prompt-submit"), session_id: session });
    assert.equal(harness.entries().length, 1);
  } finally {
    harness.cleanup();
  }
});

test("a final event flushes a queue left by earlier invocations", async () => {
  const harness = createHarness();
  try {
    const session = "sess-flush";
    await harness.run({ ...fixture("session-start"), session_id: session });
    const state = harness.readState(session);
    state.queue = [
      { payload: { panelId: 1, blocks: [{ text: "queued A" }] }, urgent: false },
      { payload: { panelId: 1, blocks: [{ text: "queued B" }] }, urgent: true },
    ];
    writeFileSync(stateFile(harness, session), JSON.stringify(state));

    await harness.run({ ...fixture("stop"), session_id: session });
    const texts = harness.entries().map((entry) => entry.text);
    assert.equal(texts[0]?.startsWith("demo session opened"), true);
    assert.equal(texts[1], "queued A");
    assert.equal(texts[2], "queued B");
    assert.match(texts[3] ?? "", /^demo Pinned the clock so the release test passes\. DONE /);
  } finally {
    harness.cleanup();
  }
});

test("malformed or unknown stdin still exits 0 and prints nothing", async () => {
  const harness = createHarness();
  try {
    for (const raw of ["not json", "", JSON.stringify({ foo: 1 }), "null"]) {
      const result = await harness.runRaw(raw);
      assert.equal(result.code, 0, `input ${raw}`);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "");
    }
    assert.equal(harness.entries().length, 0);
  } finally {
    harness.cleanup();
  }
});
