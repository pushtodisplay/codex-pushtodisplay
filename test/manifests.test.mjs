// @ts-check
/** Manifest, hook wiring, marketplace, skill, command, and release validation. */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import test from "node:test";

import { PUSHTODISPLAY_CLI_VERSION, resolveCli } from "../lib/cli-adapter.mjs";
import { repoRoot } from "./helpers.mjs";

/** @param {string} relative */
const readJson = (relative) =>
  JSON.parse(readFileSync(path.join(repoRoot, relative), "utf8"));

/** @param {string} relative */
const readText = (relative) => readFileSync(path.join(repoRoot, relative), "utf8");

/**
 * @param {string} text
 * @returns {{ frontmatter: Record<string, string>, body: string }}
 */
function frontmatter(text) {
  assert.ok(text.startsWith("---\n"), "frontmatter must start at the first byte");
  const end = text.indexOf("\n---\n", 4);
  assert.ok(end > 0, "frontmatter must be closed");
  /** @type {Record<string, string>} */
  const data = {};
  let current = "";
  for (const line of text.slice(4, end).split("\n")) {
    const match = /^([a-zA-Z0-9_-]+):\s*(.*)$/.exec(line);
    if (match?.[1]) {
      current = match[1];
      data[current] = match[2] ?? "";
    } else if (current && /^\s+/.test(line)) {
      data[current] = `${data[current]} ${line.trim()}`.trim();
    }
  }
  // Normalize YAML folded blocks (`description: >-`).
  for (const [key, value] of Object.entries(data)) {
    data[key] = value.replace(/^[>|][-+]?\s*/, "").trim();
  }
  return { frontmatter: data, body: text.slice(end + 5) };
}

test("root plugin.json is a Codex manifest with identity and components", () => {
  const plugin = readJson("plugin.json");
  assert.equal(plugin.name, "pushtodisplay");
  assert.match(plugin.name, /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/);
  assert.equal(plugin.version, readJson("package.json").version);
  assert.ok(plugin.description.length > 20);
  assert.equal(plugin.author.name, "Goban Source LLC");
  assert.equal(plugin.homepage, "https://pushtodisplay.com");
  assert.match(plugin.repository, /^https:\/\/github\.com\/pushtodisplay\/codex-pushtodisplay/);
  assert.equal(plugin.license, "MIT");
  assert.ok(Array.isArray(plugin.keywords) && plugin.keywords.includes("codex-plugin"));
  assert.equal(plugin.skills, "./skills/");
  assert.ok(existsSync(path.join(repoRoot, plugin.skills)));
  assert.equal(plugin.commands, "./commands/");
  assert.ok(existsSync(path.join(repoRoot, plugin.commands)));

  // Codex 0.167 treats a root `$schema` as the portable Agent Plugins format
  // and does not load bundled lifecycle hooks in that mode. The compatibility
  // manifest carries the OpenAI-specific settings instead.
  assert.equal(plugin.$schema, undefined, "omit $schema so Codex loads plugin hooks");
  assert.equal(plugin.extensions, undefined, "OpenAI settings belong in .codex-plugin");
});

test("the .codex-plugin compatibility manifest carries hooks, UI, and onboarding", () => {
  const plugin = readJson("plugin.json");
  const legacy = readJson(".codex-plugin/plugin.json");
  assert.equal(legacy.name, plugin.name);
  assert.equal(legacy.version, plugin.version);
  assert.equal(legacy.description, plugin.description);
  assert.equal(legacy.hooks, "./hooks/hooks.json");
  assert.ok(existsSync(path.join(repoRoot, legacy.hooks)));
  assert.equal(legacy.skills, "./skills/");
  assert.equal(legacy.commands, "./commands/");
  assert.equal(legacy.interface.displayName, "Push To Display");
  assert.equal(legacy.interface.developerName, "Goban Source LLC");
  assert.equal(legacy.interface.websiteURL, "https://pushtodisplay.com");
  assert.ok(Array.isArray(legacy.interface.defaultPrompt));

  const onboarding = legacy.extensions?.["com.openai"]?.onboardingSkill;
  assert.equal(onboarding, "./skills/setup/SKILL.md");
  assert.ok(existsSync(path.join(repoRoot, onboarding)));
  assert.equal(legacy.onboardingSkill, undefined, "0.167 reads onboarding from extensions.com.openai");
});

test("package, plugin, and compatibility versions stay in sync", () => {
  const pkg = readJson("package.json");
  assert.equal(readJson("plugin.json").version, pkg.version);
  assert.equal(readJson(".codex-plugin/plugin.json").version, pkg.version);
});

test("the repo marketplace points at the plugin root", () => {
  const marketplace = readJson(".agents/plugins/marketplace.json");
  assert.equal(marketplace.name, "pushtodisplay");
  assert.equal(marketplace.interface.displayName, "Push To Display");
  assert.equal(marketplace.plugins.length, 1);
  const entry = marketplace.plugins[0];
  assert.equal(entry.name, "pushtodisplay");
  assert.deepEqual(entry.source, { source: "local", path: "./" });
  assert.equal(entry.policy.installation, "AVAILABLE");
  assert.equal(entry.policy.authentication, "ON_INSTALL");
  assert.equal(entry.category, "Productivity");
  assert.equal(entry.interface.displayName, "Push To Display");
});

test("hooks.json wires every lifecycle event to the one silent mirror", () => {
  const hooks = readJson("hooks/hooks.json");
  const expected = [
    "Interrupt",
    "PermissionRequest",
    "PostModelRequest",
    "PostToolUse",
    "SessionEnd",
    "SessionStart",
    "Stop",
    "UserPromptSubmit",
  ];
  assert.deepEqual(Object.keys(hooks.hooks).sort(), expected);
  assert.equal(typeof hooks.description, "string");

  for (const [event, groups] of Object.entries(hooks.hooks)) {
    assert.ok(Array.isArray(groups) && groups.length > 0, `${event} has no matcher group`);
    for (const group of groups) {
      const handlers = group.hooks;
      assert.ok(Array.isArray(handlers) && handlers.length > 0, `${event} has no handler`);
      for (const handler of handlers) {
        assert.equal(handler.type, "command", `${event} must use a command handler`);
        assert.match(
          handler.command,
          /^node "\$\{PLUGIN_ROOT\}\/hooks\/hook\.mjs"$/,
          `${event} must resolve the hook through PLUGIN_ROOT`,
        );
        assert.equal(typeof handler.timeout, "number", `${event} needs an explicit timeout`);
        assert.ok(handler.timeout >= 1 && handler.timeout <= 120);
      }
    }
  }

  assert.equal(hooks.hooks.PostToolUse[0].hooks[0].async, true, "tool loops must not wait");
  assert.ok(hooks.hooks.PostModelRequest[0].hooks[0].async, "model failures can arrive late");
  assert.ok(hooks.hooks.Interrupt[0].hooks[0].timeout <= 3, "Interrupt allows at most 3s");
  assert.ok(hooks.hooks.SessionEnd[0].hooks[0].timeout <= 3, "SessionEnd allows at most 3s");
  assert.equal(hooks.hooks.PermissionRequest[0].hooks[0].async, undefined, "approval must not wait");
});

test("commands are real Codex plugin commands with frontmatter descriptions", () => {
  const expected = [
    "pushtodisplay-clear",
    "pushtodisplay-login",
    "pushtodisplay-status",
    "pushtodisplay-test",
  ];
  for (const name of expected) {
    const file = path.join(repoRoot, "commands", `${name}.md`);
    assert.ok(existsSync(file), `${name}.md is missing`);
    const parsed = frontmatter(readText(`commands/${name}.md`));
    assert.ok(parsed.frontmatter.description?.length > 10, `${name} needs a description`);
    assert.ok(parsed.body.trim().length > 20, `${name} needs a command template body`);
  }
});

test("skills carry required frontmatter", () => {
  for (const name of [
    "setup",
    "pushtodisplay",
    "pushtodisplay-clear",
    "pushtodisplay-login",
    "pushtodisplay-status",
    "pushtodisplay-test",
  ]) {
    const parsed = frontmatter(readText(`skills/${name}/SKILL.md`));
    assert.equal(parsed.frontmatter.name, name);
    assert.ok(parsed.frontmatter.description?.length > 20);
    assert.ok(parsed.body.trim().length > 100);
  }
});

test("the vendored CLI is pinned and resolves without PATH", () => {
  const vendor = readJson("vendor/pushtodisplay/package.json");
  assert.equal(vendor.name, "pushtodisplay");
  assert.equal(vendor.version, PUSHTODISPLAY_CLI_VERSION);
  assert.equal(vendor.bin.pushtodisplay, "./dist/cli.js");
  assert.ok(existsSync(path.join(repoRoot, "vendor/pushtodisplay/dist/cli.js")));

  const command = resolveCli({ env: { PATH: "" }, pluginRoot: repoRoot, cwd: repoRoot });
  assert.equal(command.source, "bundled");
  assert.ok(command.prefix[0].includes(path.join("vendor", "pushtodisplay", "dist", "cli.js")));
});

test("package scripts and published files are release-ready", () => {
  const pkg = readJson("package.json");
  assert.equal(pkg.type, "module");
  assert.equal(pkg.scripts.test, "node --test");
  assert.ok(pkg.scripts.typecheck.includes("tsc"));
  assert.ok(pkg.scripts.lint.includes("eslint"));
  assert.ok(pkg.scripts.check.includes("typecheck"));
  assert.ok(pkg.scripts.prepublishOnly.includes("check"));
  assert.ok(pkg.engines.node.includes("18"));
  assert.equal(pkg.dependencies, undefined, "the CLI is vendored, not installed from npm");
  assert.equal(pkg.bundleDependencies, undefined);

  for (const entry of ["hooks", "lib", "scripts", "skills", "commands", "plugin.json", "vendor"]) {
    assert.ok(pkg.files.includes(entry), `package files should include ${entry}`);
  }
  assert.ok(pkg.files.includes(".codex-plugin"));
  assert.ok(pkg.files.includes("docs"));
  for (const excluded of ["test", "eslint.config.mjs", "tsconfig.json", ".github", ".agents"]) {
    assert.equal(pkg.files.includes(excluded), false, `package files should exclude ${excluded}`);
  }
});

test("README and release docs document both distribution paths and the directory blocker", () => {
  const readme = readText("README.md");
  for (const phrase of [
    "codex plugin marketplace add",
    "codex plugin add",
    "npm",
    "pushtodisplay@0.1.19",
    "/hooks",
    "PUSHTODISPLAY_BOARD_ID",
    "PUSHTODISPLAY_PANEL",
    "PUSHTODISPLAY_LABEL",
    "PUSHTODISPLAY_STEPS",
    "PUSHTODISPLAY_DISABLED",
    "pushtodisplay-login",
    "npm test",
    "Troubleshooting",
    "docs/distribution.md",
    "docs/publishing.md",
  ]) {
    assert.ok(readme.includes(phrase), `README should mention ${phrase}`);
  }

  const distribution = readText("docs/distribution.md");
  for (const phrase of [
    "codex plugin marketplace add",
    "codex plugin add",
    "npm",
    "lifecycle hooks",
    "public plugin directory",
  ]) {
    assert.ok(distribution.includes(phrase), `distribution docs should mention ${phrase}`);
  }

  const publishing = readText("docs/publishing.md");
  for (const phrase of [
    "npm publish",
    "--provenance",
    "Trusted Publishing",
    "prepublishOnly",
    "npm view",
    "NPM_TOKEN",
  ]) {
    assert.ok(publishing.includes(phrase), `publishing docs should mention ${phrase}`);
  }
});

test("the hook script is executable and uses a Node shebang", () => {
  const text = readText("hooks/hook.mjs");
  assert.ok(text.startsWith("#!/usr/bin/env node"));
  assert.ok(existsSync(path.join(repoRoot, "scripts/pushtodisplay.mjs")));
});
