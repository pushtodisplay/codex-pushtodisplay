import assert from "node:assert/strict";
import { test } from "node:test";

import { loadConfig } from "../lib/config.mjs";
import { createState } from "../lib/panel-state.mjs";
import { handleEvent, toolFailed } from "../lib/events.mjs";
import { payloadText } from "../lib/messages.mjs";

const config = loadConfig({});
const wall = "11:04:22";

function run(event, state = createState({ agent: "codex", cwd: "/repo" }), cfg = config) {
  const result = handleEvent(event, state, cfg, { wall });
  return { ...result, state };
}

test("SessionStart opens the panel unless the source is compact", () => {
  const opened = run({ hook_event_name: "SessionStart", source: "startup", cwd: "/repo" });
  assert.equal(opened.actions.length, 1);
  assert.match(payloadText(opened.actions[0].payload), /session opened READY/);

  const compact = run({ hook_event_name: "SessionStart", source: "compact", cwd: "/repo" });
  assert.equal(compact.actions.length, 0);
});

test("UserPromptSubmit posts the task and ignores plugin machinery", () => {
  const normal = run({ hook_event_name: "UserPromptSubmit", prompt: "Fix the flaky release test." });
  assert.equal(normal.actions.length, 1);
  assert.match(payloadText(normal.actions[0].payload), /Fix the flaky release test\. RUN/);

  for (const prompt of ["$pushtodisplay-status", "/pushtodisplay-test", "/clear", "  "]) {
    assert.equal(run({ hook_event_name: "UserPromptSubmit", prompt }).actions.length, 0, prompt);
  }
});

test("PreToolUse and PostToolUse bracket a step", () => {
  const started = run({
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command: "npm test" },
  });
  assert.match(payloadText(started.actions[0].payload), /running npm test RUN/);

  const ok = run({
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    tool_input: { command: "npm test" },
    tool_response: { output: "ok", metadata: { exit_code: 0 } },
  });
  assert.match(payloadText(ok.actions[0].payload), /running npm test OK/);

  const failed = run({
    hook_event_name: "PostToolUse",
    tool_name: "Bash",
    tool_input: { command: "npm test" },
    tool_response: { output: "boom", metadata: { exit_code: 1 } },
  });
  assert.match(payloadText(failed.actions[0].payload), /running npm test FAIL/);
});

test("tool transport events are ignored", () => {
  assert.equal(run({ hook_event_name: "PreToolUse", tool_name: "write_stdin", tool_input: {} }).actions.length, 0);
  assert.equal(
    run({ hook_event_name: "PostToolUse", tool_name: "write_stdin", tool_input: {}, tool_response: {} }).actions.length,
    0,
  );
});

test("steps=0 disables tool and subagent lines, not lifecycle", () => {
  const quiet = loadConfig({ PUSHTODISPLAY_STEPS: "0" });
  assert.equal(
    run({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" } }, undefined, quiet).actions.length,
    0,
  );
  assert.equal(run({ hook_event_name: "SubagentStart", agent_type: "Explore" }, undefined, quiet).actions.length, 0);
  assert.equal(run({ hook_event_name: "SessionEnd", reason: "other" }, undefined, quiet).actions.length, 1);
});

test("PermissionRequest logs without making a decision", () => {
  const result = run({
    hook_event_name: "PermissionRequest",
    tool_name: "Bash",
    tool_input: { command: "git push", description: "push the branch" },
  });
  assert.equal(result.actions.length, 1);
  assert.match(payloadText(result.actions[0].payload), /Allow Bash: push the branch NEEDS/);
  // The handler returns only a payload; there is no decision field to emit.
  assert.equal(Object.hasOwn(result.actions[0], "decision"), false);
});

test("Stop remembers and reports the last assistant message", () => {
  const state = createState({ agent: "codex", cwd: "/repo" });
  const result = run(
    { hook_event_name: "Stop", last_assistant_message: "Fixed the test and updated the docs." },
    state,
  );
  assert.match(payloadText(result.actions[0].payload), /Fixed the test and updated the docs\. DONE/);
  assert.equal(state.lastAssistantText, "Fixed the test and updated the docs.");
});

test("PostModelRequest only reports failed attempts", () => {
  assert.equal(run({ hook_event_name: "PostModelRequest", status: "completed" }).actions.length, 0);
  const failed = run({ hook_event_name: "PostModelRequest", status: "failed", error: "rate limit reached" });
  assert.match(payloadText(failed.actions[0].payload), /rate limit reached FAIL/);
});

test("SubagentStart and SubagentStop are low-noise step lines", () => {
  const start = run({ hook_event_name: "SubagentStart", agent_type: "Explore" });
  assert.match(payloadText(start.actions[0].payload), /delegating to Explore RUN/);
  const stop = run({ hook_event_name: "SubagentStop", agent_type: "Explore" });
  assert.match(payloadText(stop.actions[0].payload), /subagent Explore finished OK/);
});

test("Interrupt and SessionEnd produce closing lines", () => {
  assert.match(payloadText(run({ hook_event_name: "Interrupt" }).actions[0].payload), /interrupted before it finished STOP/);
  assert.match(payloadText(run({ hook_event_name: "SessionEnd", reason: "other" }).actions[0].payload), /session closed ENDED/);
});

test("unknown events produce nothing", () => {
  assert.equal(run({ hook_event_name: "SomeFutureEvent" }).actions.length, 0);
});

test("toolFailed understands the common tool_response shapes", () => {
  assert.equal(toolFailed({ exit_code: 0 }), false);
  assert.equal(toolFailed({ exit_code: 2 }), true);
  assert.equal(toolFailed({ metadata: { exit_code: 1 } }), true);
  assert.equal(toolFailed({ success: false }), true);
  assert.equal(toolFailed({ error: "boom" }), true);
  assert.equal(toolFailed("Process exited with code 1"), true);
  assert.equal(toolFailed("everything is fine"), false);
  assert.equal(toolFailed({ output: "Exit code: 1" }), true);
  assert.equal(toolFailed(null), false);
});
