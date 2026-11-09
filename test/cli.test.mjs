// @ts-check
/** The operator CLI: login/status/test/clear against a fake pushtodisplay. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import test from "node:test";

import { isSetupComplete } from "../lib/setup-state.mjs";
import { createHarness, repoRoot } from "./helpers.mjs";

const script = path.join(repoRoot, "scripts", "pushtodisplay.mjs");

/**
 * @param {import("./helpers.mjs").Harness} harness
 * @param {string[]} args
 * @param {Record<string, string>} [overrides]
 */
function runScript(harness, args, overrides = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      env: { ...harness.env, PUSHTODISPLAY_NO_BROWSER: "1", ...overrides },
      stdio: ["ignore", "pipe", "pipe"],
    });
    /** @type {Buffer[]} */
    const out = [];
    /** @type {Buffer[]} */
    const err = [];
    child.stdout.on("data", (chunk) => out.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => err.push(Buffer.from(chunk)));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({
        code,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
      }),
    );
  });
}

test("status reports the resolved CLI, config, and auth state", async () => {
  const harness = createHarness({ auth: false });
  try {
    const result = await runScript(harness, ["status", "--json"], {
      PUSHTODISPLAY_PANEL: "2",
      PUSHTODISPLAY_LABEL: "ci",
      PUSHTODISPLAY_BOARD_ID: "board-9",
      PUSHTODISPLAY_STEPS: "0",
    });
    assert.equal(result.code, 0);
    const status = JSON.parse(result.stdout);
    assert.equal(status.auth.state, "unauthenticated");
    assert.equal(status.authChecked, true);
    assert.equal(status.authenticated, false);
    assert.equal(status.setup, true);
    assert.ok(status.setupCompletedAt > 0);
    assert.ok(status.setupFile.endsWith("setup.json"));
    assert.equal(status.panel, 2);
    assert.equal(status.label, "ci");
    assert.equal(status.boardId, "board-9");
    assert.equal(status.steps, false);
    assert.equal(status.disabled, false);
    assert.ok(status.cli.includes("pushtodisplay"));
    assert.ok(status.cli.includes("env"));
    assert.ok(status.cacheDir);
  } finally {
    harness.cleanup();
  }
});

test("status with a setup marker and an unavailable auth probe does not claim logout", async () => {
  const harness = createHarness({ setup: true });
  try {
    const result = await runScript(harness, ["status"], {
      FAKE_PTD_AUTH_MODE: "unavailable",
    });
    assert.equal(result.code, 0);
    assert.match(result.stdout, /^Setup: {4}complete$/m);
    assert.match(result.stdout, /^Auth: {5}not checked here/m);
    assert.equal(result.stdout.includes("not logged in"), false);

    const json = await runScript(harness, ["status", "--json"], {
      FAKE_PTD_AUTH_MODE: "unavailable",
    });
    const status = JSON.parse(json.stdout);
    assert.equal(status.setup, true);
    assert.equal(status.auth.state, "unavailable");
    assert.equal(status.authChecked, false);
    assert.equal(status.authenticated, null);
  } finally {
    harness.cleanup();
  }
});

test("status without a setup marker still says setup is required", async () => {
  const harness = createHarness({ setup: false });
  try {
    const result = await runScript(harness, ["status"], {
      FAKE_PTD_AUTH_MODE: "unavailable",
    });
    assert.equal(result.code, 0);
    assert.match(result.stdout, /^Setup: {4}not complete — run: \$pushtodisplay:setup/m);
    assert.match(result.stdout, /^Auth: {5}not checked here/m);
    assert.equal(result.stdout.includes("not logged in"), false);
  } finally {
    harness.cleanup();
  }
});

test("setup sends a test entry and writes the Codex setup marker", async () => {
  const harness = createHarness({ setup: false });
  try {
    const result = await runScript(harness, ["setup"], {
      PUSHTODISPLAY_PANEL: "2",
      PUSHTODISPLAY_LABEL: "ci",
      PUSHTODISPLAY_BOARD_ID: "board-9",
    });
    assert.equal(result.code, 0);
    assert.match(result.stdout, /Push To Display setup complete for Codex/);
    assert.match(result.stdout, /Test entry: ci link OK, panel 2 OK \d{2}:\d{2}\./);
    assert.equal(result.stdout.includes("/hooks"), false, "success must not nag about hook trust");
    assert.equal(result.stdout.trim().split("\n").length, 1, "setup should print one outcome line");
    assert.equal(harness.entries().length, 1);
    assert.match(harness.entries()[0]?.text ?? "", /^ci link OK, panel 2 OK \d{2}:\d{2}$/);
    assert.equal(isSetupComplete(harness.env), true);
  } finally {
    harness.cleanup();
  }
});

test("setup does not mark completion when login still fails", async () => {
  const harness = createHarness({ setup: false, auth: false });
  try {
    const result = await runScript(harness, ["setup"], { FAKE_PTD_AUTH: "0" });
    assert.equal(result.code, 1);
    assert.equal(isSetupComplete(harness.env), false);
    assert.equal(
      (result.stderr.match(/normal terminal/g) ?? []).length,
      1,
      "login failure should produce one recovery hint, not one per layer",
    );
  } finally {
    harness.cleanup();
  }
});

test("setup in a sandbox prints one host-side recovery hint and never starts login", async () => {
  const harness = createHarness({ setup: false });
  try {
    const result = await runScript(harness, ["setup"], {
      FAKE_PTD_AUTH_MODE: "unavailable",
    });
    assert.equal(result.code, 1);
    assert.equal(isSetupComplete(harness.env), false);
    assert.equal(result.stdout.includes("device-code login"), false);
    assert.match(result.stderr, /cannot reach the credential store or network/);
    assert.match(result.stderr, /Run setup from a normal terminal/);
    assert.equal((result.stderr.match(/normal terminal/g) ?? []).length, 1);
    assert.equal(result.stderr.includes("Login exited"), false);
  } finally {
    harness.cleanup();
  }
});

test("a failed login inside setup does not add a second network hint", async () => {
  const harness = createHarness({ setup: false, auth: false });
  try {
    const result = await runScript(harness, ["setup"], {
      FAKE_PTD_AUTH: "0",
      FAKE_PTD_LOGIN_EXIT: "2",
    });
    assert.equal(result.code, 1);
    assert.equal(isSetupComplete(harness.env), false);
    assert.match(result.stderr, /Login failed \(exit 2\)/);
    assert.equal((result.stderr.match(/normal terminal/g) ?? []).length, 1);
    assert.equal(result.stderr.includes("Setup did not complete"), false);
  } finally {
    harness.cleanup();
  }
});

test("test and clear send a correctly labelled line", async () => {
  const harness = createHarness();
  try {
    const tested = await runScript(harness, ["test"], {
      PUSHTODISPLAY_PANEL: "2",
      PUSHTODISPLAY_LABEL: "ci",
      PUSHTODISPLAY_BOARD_ID: "board-9",
    });
    assert.equal(tested.code, 0);
    assert.match(tested.stdout, /Sent: ci link OK, panel 2 OK \d{2}:\d{2}/);

    const cleared = await runScript(harness, ["clear"], {
      PUSHTODISPLAY_PANEL: "2",
      PUSHTODISPLAY_LABEL: "ci",
      PUSHTODISPLAY_BOARD_ID: "board-9",
    });
    assert.equal(cleared.code, 0);
    assert.match(cleared.stdout, /Sent: ci log cleared OK \d{2}:\d{2}/);

    const entries = harness.entries();
    assert.equal(entries.length, 2);
    assert.equal(entries[0]?.panel, 2);
    assert.equal(entries[0]?.boardId, "board-9");
    assert.match(entries[0]?.text ?? "", /^ci link OK, panel 2 OK \d{2}:\d{2}$/);
    assert.match(entries[1]?.text ?? "", /^ci log cleared OK \d{2}:\d{2}$/);
  } finally {
    harness.cleanup();
  }
});

test("login shows the URL and code, then records a successful login hint", async () => {
  const harness = createHarness();
  try {
    const result = await runScript(harness, ["login"], { FAKE_PTD_AUTH: "1" });
    assert.equal(result.code, 0);
    assert.match(result.stdout, /https:\/\/example\.com\/device/);
    assert.match(result.stdout, /ABCD-1234/);
    assert.match(result.stdout, /Logged in\./);
    const hint = JSON.parse(readFileSync(path.join(harness.cache, "auth.json"), "utf8"));
    assert.equal(hint.ok, true);
    assert.ok(hint.at > 0);
    assert.ok(existsSync(path.join(harness.cache, "auth.json")));
  } finally {
    harness.cleanup();
  }
});

test("login fails clearly when the flow exits non-zero", async () => {
  const harness = createHarness();
  try {
    const result = await runScript(harness, ["login"], {
      FAKE_PTD_AUTH: "0",
      FAKE_PTD_LOGIN_EXIT: "2",
    });
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Login failed \(exit 2\)/);
    assert.equal(existsSync(path.join(harness.cache, "auth.json")), false);
  } finally {
    harness.cleanup();
  }
});
