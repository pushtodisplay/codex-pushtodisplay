import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const hook = path.join(root, "hooks", "hook.mjs");
const fakeCli = path.join(root, "fixtures", "fake-cli.mjs");

/**
 * Run hook.mjs with one event. The fake CLI makes the test local: no network,
 * no credentials, no board.
 */
function run(event, env) {
  const result = spawnSync(process.execPath, [hook], {
    input: JSON.stringify(event),
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 20_000,
  });
  return result;
}

function sends(logPath) {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function payloads(logPath) {
  return sends(logPath).map((args) => {
    const blocks = [];
    for (let i = 0; i < args.length; i += 1) {
      if (args[i] === "--block") blocks.push(JSON.parse(args[i + 1]));
    }
    return blocks.map((b) => b.text).join("");
  });
}

test("a full hook sequence reaches the fake CLI in order with no stdout", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "p2d-hook-"));
  const log = path.join(dir, "sends.jsonl");
  const env = {
    PUSHTODISPLAY_CLI: fakeCli,
    FAKE_CLI_LOG: log,
    PUSHTODISPLAY_CACHE_DIR: path.join(dir, "cache"),
    PUSHTODISPLAY_MIN_INTERVAL_MS: "5",
  };
  const session = `test-${process.pid}`;
  const common = { session_id: session, cwd: dir };

  const events = [
    { ...common, hook_event_name: "SessionStart", source: "startup" },
    { ...common, hook_event_name: "UserPromptSubmit", prompt: "Fix the flaky release test." },
    {
      ...common,
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
    },
    {
      ...common,
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "npm test" },
      tool_response: { output: "boom", metadata: { exit_code: 1 } },
    },
    { ...common, hook_event_name: "Stop", last_assistant_message: "Fixed the flaky test." },
  ];

  for (const event of events) {
    const result = run(event, env);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "", `stdout must stay empty for ${event.hook_event_name}`);
  }

  const lines = payloads(log);
  assert.ok(lines.length >= 4, `expected at least four sends, got ${lines.length}`);
  assert.match(lines[0], /session opened READY/);
  assert.match(lines[1], /Fix the flaky release test\. RUN/);
  assert.match(lines[2], /running npm test RUN/);
  assert.match(lines[3], /running npm test FAIL/);
  const last = lines.at(-1) ?? "";
  assert.match(last, /Fixed the flaky test\. DONE/);
});

test("PUSHTODISPLAY_DISABLED=1 suppresses all activity", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "p2d-disabled-"));
  const log = path.join(dir, "sends.jsonl");
  const result = run(
    {
      session_id: "disabled",
      cwd: dir,
      hook_event_name: "SessionStart",
      source: "startup",
    },
    {
      PUSHTODISPLAY_CLI: fakeCli,
      FAKE_CLI_LOG: log,
      PUSHTODISPLAY_CACHE_DIR: path.join(dir, "cache"),
      PUSHTODISPLAY_DISABLED: "1",
    },
  );
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.deepEqual(sends(log), []);
});
