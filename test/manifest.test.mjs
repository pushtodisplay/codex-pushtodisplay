import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { test } from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (rel) => JSON.parse(readFileSync(path.join(root, rel), "utf8"));

const plugin = read(".codex-plugin/plugin.json");
const marketplace = read(".agents/plugins/marketplace.json");
const pkg = read("package.json");
const hooks = read("hooks/hooks.json");

test("plugin manifest has the required identity and metadata", () => {
  assert.equal(plugin.name, "pushtodisplay");
  assert.equal(plugin.version, pkg.version);
  assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
  assert.ok(plugin.description.length > 20);
  assert.equal(plugin.author.name, "Goban Source LLC");
  assert.equal(plugin.homepage, "https://pushtodisplay.com");
  assert.match(plugin.repository, /^https:\/\/github\.com\/pushtodisplay\//);
  assert.equal(plugin.license, "MIT");
  assert.ok(Array.isArray(plugin.keywords));
  assert.ok(plugin.keywords.includes("codex-plugin"));
  assert.match(plugin.name, /^[a-z0-9][a-z0-9.-]*$/);
  assert.equal(plugin.interface.displayName, "Push To Display");
  assert.ok(plugin.interface.shortDescription.length <= 30);
});

test("the compatibility manifest explicitly points at the hooks file", () => {
  // Codex 0.167.0 only loads plugin hooks when the compatibility manifest
  // declares the path; relying on hooks/hooks.json alone produced no hook run.
  assert.equal(plugin.hooks, "./hooks/hooks.json");
  assert.ok(existsSync(path.join(root, plugin.hooks)));
  assert.equal(plugin.skills, "./skills/");
  assert.ok(existsSync(path.join(root, plugin.skills)));
});

test("marketplace is a single-plugin catalog rooted at this repo", () => {
  assert.equal(marketplace.name, "pushtodisplay");
  assert.equal(marketplace.interface.displayName, "Push To Display");
  assert.equal(marketplace.plugins.length, 1);
  const entry = marketplace.plugins[0];
  assert.equal(entry.name, plugin.name);
  assert.deepEqual(entry.source, { source: "local", path: "./" });
  assert.equal(entry.policy.installation, "AVAILABLE");
  assert.equal(entry.policy.authentication, "ON_INSTALL");
  assert.ok(entry.category.length > 0);
});

test("hooks use Codex events, the command form, and PLUGIN_ROOT", () => {
  assert.ok(hooks.description);
  const expected = [
    "SessionStart",
    "SessionEnd",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PermissionRequest",
    "Stop",
    "SubagentStart",
    "SubagentStop",
    "Interrupt",
    "PostModelRequest",
  ];
  assert.deepEqual(Object.keys(hooks.hooks).sort(), expected.sort());

  for (const [event, groups] of Object.entries(hooks.hooks)) {
    assert.ok(Array.isArray(groups), `${event} groups`);
    assert.ok(groups.length > 0, `${event} has a handler`);
    for (const group of groups) {
      assert.ok(Array.isArray(group.hooks), `${event} handler list`);
      for (const handler of group.hooks) {
        assert.equal(handler.type, "command", `${event} type`);
        assert.equal(handler.command, "node ${PLUGIN_ROOT}/hooks/hook.mjs", `${event} command`);
        if (handler.timeout !== undefined) {
          assert.equal(typeof handler.timeout, "number");
          assert.ok(handler.timeout > 0);
        }
        assert.equal(handler.async, undefined, `${event} stays synchronous`);
      }
    }
  }

  // Codex has no StopFailure/PostToolUseFailure events.
  assert.equal(Object.hasOwn(hooks.hooks, "StopFailure"), false);
  assert.equal(Object.hasOwn(hooks.hooks, "PostToolUseFailure"), false);
});

test("all handlers are synchronous and short-lived hooks respect Codex timeouts", () => {
  // The hook process enqueues and returns immediately (or flushes on Stop /
  // SessionEnd / Interrupt), so async handlers are unnecessary.
  for (const [event, groups] of Object.entries(hooks.hooks)) {
    for (const group of groups) {
      for (const handler of group.hooks) {
        assert.equal(handler.async, undefined, `${event} stays synchronous`);
      }
    }
  }
  // Documented maxima: SessionEnd and Interrupt support at most 3 seconds.
  assert.ok(hooks.hooks.SessionEnd[0].hooks[0].timeout <= 3);
  assert.ok(hooks.hooks.Interrupt[0].hooks[0].timeout <= 3);
});

test("plugin files referenced by the manifest and package exist", () => {
  for (const rel of [
    "hooks/hook.mjs",
    "lib/config.mjs",
    "lib/payloads.mjs",
    "lib/messages.mjs",
    "lib/describe.mjs",
    "lib/sender.mjs",
    "lib/auth-gate.mjs",
    "lib/cli-adapter.mjs",
    "lib/events.mjs",
    "lib/state.mjs",
    "lib/device-code.mjs",
    "scripts/command.mjs",
    "scripts/login-worker.mjs",
    "README.md",
    "LICENSE",
  ]) {
    assert.ok(existsSync(path.join(root, rel)), `missing ${rel}`);
  }
  for (const rel of pkg.files) {
    assert.ok(existsSync(path.join(root, rel)), `package files entry missing: ${rel}`);
  }
});

test("skills are packaged with valid front matter and call the command script", () => {
  for (const name of ["login", "status", "test", "clear"]) {
    const file = path.join(root, "skills", `pushtodisplay-${name}`, "SKILL.md");
    const text = readFileSync(file, "utf8");
    assert.match(text, /^---\nname: pushtodisplay-/);
    assert.match(text, /\ndescription: /);
    assert.match(text, /scripts\/command\.mjs/);
    assert.match(text, new RegExp(`command\\.mjs" ${name}`));
  }
});
