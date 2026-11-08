// @ts-check
/** The operator CLI: login/status/test/clear against a fake pushtodisplay. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import test from "node:test";

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
    assert.equal(status.authenticated, false);
    assert.equal(status.panel, 2);
    assert.equal(status.label, "ci");
    assert.equal(status.boardId, "board-9");
    assert.equal(status.steps, false);
    assert.equal(status.disabled, false);
    assert.ok(status.cli.includes("pushtodisplay"));
    assert.ok(status.cli.includes("path"));
    assert.ok(status.cacheDir);
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
    assert.match(result.stderr, /Login exited with code 2/);
    assert.equal(existsSync(path.join(harness.cache, "auth.json")), false);
  } finally {
    harness.cleanup();
  }
});
