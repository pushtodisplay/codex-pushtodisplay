// @ts-check
/** Status semantics: setup marker and auth probe are independent. */
import assert from "node:assert/strict";
import test from "node:test";

import { loadConfig } from "../lib/config.mjs";
import { buildStatus, formatStatus } from "../lib/status.mjs";

const config = loadConfig({
  PUSHTODISPLAY_BOARD_ID: "board-9",
  PUSHTODISPLAY_PANEL: "2",
  PUSHTODISPLAY_LABEL: "ci",
});
const setupRecord = {
  version: 1,
  completedAt: 1_700_000_000_000,
  boardId: "board-9",
  panel: 2,
  label: "ci",
  cliVersion: "0.1.19",
};

/**
 * @param {import("../lib/cli-adapter.mjs").AuthCheckState} state
 * @param {object | null} record
 */
function report(state, record) {
  return formatStatus(
    buildStatus({
      config,
      cwd: "/work/repo",
      cli: "/tmp/pushtodisplay (bundled)",
      auth: { state, reason: state === "unavailable" ? "probe could not run" : null },
      setupRecord: /** @type {any} */ (record),
      setupFile: "/tmp/setup.json",
      cacheDir: "/tmp/cache",
    }),
  );
}

test("setup complete + auth unavailable is not reported as logged out", () => {
  const text = report("unavailable", setupRecord);
  assert.match(text, /^Setup: {4}complete$/m);
  assert.match(text, /^Auth: {5}not checked here/m);
  assert.match(text, /does not mean logged out/);
  assert.equal(text.includes("not logged in"), false);
  assert.equal(text.includes("$pushtodisplay:setup"), false);
});

test("setup required is independent of an unavailable auth probe", () => {
  const text = report("unavailable", null);
  assert.match(text, /^Setup: {4}not complete — run: \$pushtodisplay:setup/m);
  assert.match(text, /^Auth: {5}not checked here/m);
  assert.equal(text.includes("not logged in"), false);
});

test("only a positive logged-out answer is reported as not logged in", () => {
  const text = report("unauthenticated", setupRecord);
  assert.match(text, /^Setup: {4}complete$/m);
  assert.match(text, /^Auth: {5}not logged in — run: \$pushtodisplay:setup/m);
});

test("a positive auth answer is reported as logged in", () => {
  const text = report("authenticated", setupRecord);
  assert.match(text, /^Auth: {5}logged in$/m);
  assert.equal(text.includes("not checked"), false);
});

test("JSON status exposes the tri-state without lying about authentication", () => {
  const data = buildStatus({
    config,
    cwd: "/work/repo",
    cli: "pushtodisplay",
    auth: { state: "unavailable", reason: "sandbox" },
    setupRecord,
    setupFile: "/tmp/setup.json",
    cacheDir: "/tmp/cache",
  });
  assert.equal(data.auth.state, "unavailable");
  assert.equal(data.auth.reason, "sandbox");
  assert.equal(data.authenticated, null);
  assert.equal(data.authChecked, false);
  assert.equal(data.setup, true);
  assert.equal(data.setupCompletedAt, setupRecord.completedAt);
  assert.equal(data.boardId, "board-9");
  assert.equal(data.panel, 2);
  assert.equal(data.label, "ci");
});
