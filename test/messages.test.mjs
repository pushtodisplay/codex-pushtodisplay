import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clearedMessage,
  doneMessage,
  errorMessage,
  payloadText,
  permissionMessage,
  sessionClosedMessage,
  sessionOpenedMessage,
  stepMessage,
  stoppedMessage,
  subagentFinishedMessage,
  subagentStartedMessage,
  taskMessage,
  testMessage,
  toolStartedMessage,
} from "../lib/messages.mjs";

const base = { panelId: 2, agent: "codex", wall: "11:04:22" };

test("every message uses the same four-run shape", () => {
  const payload = sessionOpenedMessage(base);
  assert.equal(payload.panelId, 2);
  assert.equal(payload.density, "compact");
  assert.equal(payload.background, "#1b2430");
  assert.equal(payload.blocks.length, 4);
  assert.equal(payload.blocks[0].text, "codex");
  assert.equal(payload.blocks[1].text, " session opened");
  assert.equal(payload.blocks[2].text, " READY");
  assert.equal(payload.blocks[3].text, " 11:04");
});

test("session lifecycle", () => {
  assert.match(payloadText(sessionOpenedMessage(base)), /session opened READY/);
  assert.match(payloadText(sessionClosedMessage(base)), /session closed ENDED/);
});

test("prompt is shortened to one readable sentence", () => {
  const text = payloadText(
    taskMessage({
      ...base,
      cwd: "/repo",
      task: "Please investigate why the release test is flaky. It happens about once a day.",
    }),
  );
  assert.match(text, /Please investigate why the release test is flaky\. RUN/);
  assert.doesNotMatch(text, /It happens/);
});

test("tool start and result differ only in status", () => {
  const args = { command: "npm test | head" };
  const started = payloadText(toolStartedMessage({ ...base, cwd: "/repo", toolName: "Bash", args }));
  const ok = payloadText(stepMessage({ ...base, cwd: "/repo", toolName: "Bash", args, ok: true }));
  const fail = payloadText(stepMessage({ ...base, cwd: "/repo", toolName: "Bash", args, ok: false }));
  assert.match(started, /running npm test RUN/);
  assert.match(ok, /running npm test OK/);
  assert.match(fail, /running npm test FAIL/);
});

test("paths are shortened against the session cwd", () => {
  const text = payloadText(
    stepMessage({
      ...base,
      cwd: "/home/me/project",
      toolName: "Read",
      args: { file_path: "/home/me/project/src/a.ts" },
      ok: true,
    }),
  );
  assert.match(text, /reading src\/a\.ts OK/);
});

test("apply_patch and MCP tools are described plainly", () => {
  assert.match(
    payloadText(
      stepMessage({
        ...base,
        toolName: "apply_patch",
        args: { command: "*** Begin Patch" },
        ok: true,
      }),
    ),
    /applying a patch OK/,
  );
  assert.match(
    payloadText(
      stepMessage({
        ...base,
        toolName: "mcp__filesystem__read_file",
        args: { path: "/tmp/x" },
        ok: true,
      }),
    ),
    /filesystem: read_file/,
  );
});

test("permission line prefers the Codex approval description", () => {
  const text = payloadText(
    permissionMessage({
      ...base,
      toolName: "Bash",
      args: { command: "git push", description: "push the release branch" },
      description: "push the release branch",
    }),
  );
  assert.match(text, /Allow Bash: push the release branch NEEDS/);
});

test("permission line falls back to the tool input", () => {
  const text = payloadText(
    permissionMessage({
      ...base,
      toolName: "Bash",
      args: { command: "git push origin main" },
    }),
  );
  assert.match(text, /Allow Bash: git push origin main NEEDS/);
});

test("done uses the assistant's last message", () => {
  const text = payloadText(
    doneMessage({ ...base, text: "Pinned the clock so the release test passes." }),
  );
  assert.match(text, /Pinned the clock so the release test passes\. DONE/);
});

test("done never renders blank", () => {
  assert.match(payloadText(doneMessage({ ...base, text: "" })), /no summary DONE/);
});

test("failure, interrupt, subagent, test, and clear lines", () => {
  assert.match(payloadText(errorMessage({ ...base, detail: "rate limit reached" })), /rate limit reached FAIL/);
  assert.match(payloadText(stoppedMessage(base)), /interrupted before it finished STOP/);
  assert.match(payloadText(subagentStartedMessage({ ...base, agentType: "Explore" })), /delegating to Explore RUN/);
  assert.match(payloadText(subagentFinishedMessage({ ...base, agentType: "Explore" })), /subagent Explore finished OK/);
  assert.match(payloadText(testMessage(base)), /link OK, panel 2 OK/);
  assert.match(payloadText(clearedMessage(base)), /log cleared OK/);
});
