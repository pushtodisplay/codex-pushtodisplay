// @ts-check
import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanCommand,
  describePermission,
  describeTool,
  isToolFailure,
  patchSummary,
  shortenPath,
  MAX_DESC,
} from "../lib/describe.mjs";

const cwd = "/Users/me/proj";

test("Bash commands are described in plain language", () => {
  assert.equal(describeTool("Bash", { command: "npm test\nnpm run lint" }), "running npm test");
  assert.equal(
    describeTool("Bash", { command: "cd /tmp && npm test 2>&1 | head -20" }),
    "running npm test",
  );
  assert.equal(describeTool("Bash", { command: "FOO=1 BAR=2 make build > /dev/null" }), "running make build");
  assert.equal(describeTool("Bash", { command: `echo ${"y".repeat(200)}` }), "running echo");
  assert.equal(describeTool("Bash", { command: "git push -u origin main" }), "running git push -u origin main");
  assert.ok(describeTool("Bash", { command: `echo ${"y".repeat(200)}` }).length <= MAX_DESC);
});

test("exec_command and shell aliases use the same command mapping", () => {
  assert.equal(describeTool("exec_command", { cmd: "npm ci" }), "running npm ci");
  assert.equal(describeTool("shell", { command: "ls -la src" }), "running ls -la src");
});

test("file tools shorten paths and never lose the file name", () => {
  assert.equal(describeTool("read_file", { path: `${cwd}/src/a.ts` }, { cwd }), "reading src/a.ts");
  assert.equal(describeTool("Write", { file_path: `${cwd}/out/b.ts` }, { cwd }), "writing out/b.ts");
  assert.equal(describeTool("edit", { path: "src/index.ts" }), "editing src/index.ts");
  assert.equal(describeTool("view_image", { image_path: `${cwd}/pic.png` }, { cwd }), "viewing pic.png");
});

test("edits carry a diff stat and then give up detail in a fixed order", () => {
  assert.equal(
    describeTool("Edit", { file_path: "src/a.ts", old_string: "a\nb", new_string: "a\nb\nc\nd" }),
    "editing src/a.ts (+4 −2)",
  );
  const long = describeTool(
    "edit",
    { path: `${cwd}/very/long/directory/that/keeps/going/file-name-with-extension.ts`, newText: "x" },
    { cwd, max: 48 },
  );
  assert.ok(long.length <= 48);
  assert.ok(long.includes("editing"));
});

test("apply_patch reads the patch and names the file", () => {
  const patch = [
    "*** Begin Patch",
    "*** Update File: src/release.ts",
    "@@",
    "-const clock = Date.now();",
    "+const clock = () => 0;",
    "+const fixed = true;",
    "*** End Patch",
  ].join("\n");
  assert.deepEqual(patchSummary(patch), {
    action: "update",
    file: "src/release.ts",
    added: 2,
    removed: 1,
  });
  assert.equal(
    describeTool("apply_patch", { command: patch }),
    "editing src/release.ts (+2 −1)",
  );
  assert.equal(describeTool("apply_patch", { command: "*** Begin Patch\n*** End Patch" }), "applying a patch");
});

test("searches, fetches, plans and delegation have dedicated verbs", () => {
  assert.equal(describeTool("grep", { pattern: "TODO", path: "src" }), "searching for TODO in src");
  assert.equal(describeTool("glob", { pattern: "**/*.ts" }), "finding **/*.ts");
  assert.equal(describeTool("web_search", { query: "codex hooks" }), "searching the web for codex hooks");
  assert.equal(describeTool("web_fetch", { url: "https://example.com/a" }), "fetching example.com/a");
  assert.equal(describeTool("update_plan", { plan: [] }), "updating the plan");
  assert.equal(describeTool("spawn_agent", { task: "audit the release test" }), "delegating: audit the release test");
  assert.equal(describeTool("write_stdin", { chars: "y" }), "writing to the terminal: y");
  assert.equal(describeTool("tool_search", { query: "browser" }), "looking up a tool for browser");
});

test("MCP tool names stay recognisable", () => {
  assert.equal(describeTool("mcp__filesystem__read_file", { path: "a" }), "using filesystem.read_file");
  assert.equal(describeTool("mcp__github__search_issues", { q: "bug" }), "using github.search_issues");
});

test("unknown tools fall back to tool(arg: value) and never render blank", () => {
  const out = describeTool("mystery", { owner: "pushtodisplay", repo: "cli" });
  assert.ok(out.includes("mystery("));
  assert.ok(out.includes("owner: pushtodisplay"));
  assert.equal(describeTool("mystery", {}), "mystery");
  assert.equal(describeTool("mystery", undefined), "mystery");
});

test("shortenPath rewrites cwd, home, and outside paths", () => {
  assert.equal(shortenPath("/Users/me/notes.md", { home: "/Users/me" }), "~/notes.md");
  assert.equal(shortenPath("/var/log/x", { home: "/Users/me" }), "…/x");
});

test("PermissionRequest bodies are the question, not a category", () => {
  assert.equal(
    describePermission("Bash", { command: "git push --force-with-lease" }),
    "Allow bash: git push --force-with-lease",
  );
  assert.equal(
    describePermission("apply_patch", {
      command: "*** Begin Patch\n*** Update File: src/release.ts\n*** End Patch",
    }),
    "Allow apply_patch: src/release.ts",
  );
  assert.equal(describePermission("mcp__linear__create_issue", {}), "Allow linear.create_issue");
  assert.equal(
    describePermission("Bash", { command: "rm -rf /", description: "Delete the build directory" }),
    "Delete the build directory",
  );
});

test("cleanCommand removes shell boilerplate", () => {
  assert.equal(cleanCommand("  npm   run   build  "), "npm run build");
  assert.equal(cleanCommand("cd /tmp && npm test | tail -5"), "npm test");
  assert.equal(cleanCommand("   \n  "), "");
});

test("isToolFailure detects non-zero exits and error markers", () => {
  assert.equal(isToolFailure("Process exited with code 1\nboom"), true);
  assert.equal(isToolFailure("process exited with exit code 2"), true);
  assert.equal(isToolFailure("Command failed: npm test"), true);
  assert.equal(isToolFailure("apply_patch verification failed: no such file"), true);
  assert.equal(isToolFailure("Traceback (most recent call last):\n  ..."), true);
  assert.equal(isToolFailure("zsh: command not found: nope"), true);
  assert.equal(isToolFailure("Error: token expired"), true);
  assert.equal(isToolFailure("FAIL src/release.test.ts\n1 failing"), true);
  assert.equal(isToolFailure("1 failed, 10 passed"), true);
  assert.equal(isToolFailure("AssertionError: expected 1 to equal 2"), true);
  assert.equal(isToolFailure("npm ERR! code ELIFECYCLE"), true);
  assert.equal(isToolFailure("not ok 1 - flaky release test"), true);
  assert.equal(isToolFailure("Process exited with code 0\nAll good"), false);
  assert.equal(isToolFailure("0 errors, 112 tests passed"), false);
  assert.equal(isToolFailure(""), false);
});

test("isToolFailure understands structured tool responses", () => {
  assert.equal(isToolFailure({ success: false }), true);
  assert.equal(isToolFailure({ ok: false }), true);
  assert.equal(isToolFailure({ isError: true }), true);
  assert.equal(isToolFailure({ error: "nope" }), true);
  assert.equal(isToolFailure({ status: "failed" }), true);
  assert.equal(isToolFailure({ exit_code: 2 }), true);
  assert.equal(isToolFailure({ exitCode: 0 }), false);
  assert.equal(isToolFailure({ content: [{ isError: true }] }), true);
  assert.equal(isToolFailure({ content: [{ type: "text", text: "ok" }] }), false);
  assert.equal(isToolFailure(null), false);
});
