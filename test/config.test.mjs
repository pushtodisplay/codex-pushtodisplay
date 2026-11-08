// @ts-check
import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_INTERVAL_MS,
  MAX_PANEL,
  MIN_PANEL,
  agentLabel,
  cacheDir,
  clock,
  loadConfig,
  num,
  truncate,
} from "../lib/config.mjs";

test("loadConfig uses the documented defaults", () => {
  assert.deepEqual(loadConfig({}), {
    boardId: "",
    panel: 1,
    label: "",
    disabled: false,
    steps: true,
    intervalMs: DEFAULT_INTERVAL_MS,
  });
});

test("loadConfig reads every documented environment variable", () => {
  const config = loadConfig({
    PUSHTODISPLAY_BOARD_ID: "board-42",
    PUSHTODISPLAY_PANEL: "3",
    PUSHTODISPLAY_LABEL: "cicd",
    PUSHTODISPLAY_DISABLED: "1",
    PUSHTODISPLAY_STEPS: "0",
    PUSHTODISPLAY_SEND_INTERVAL_MS: "25",
  });
  assert.equal(config.boardId, "board-42");
  assert.equal(config.panel, 3);
  assert.equal(config.label, "cicd");
  assert.equal(config.disabled, true);
  assert.equal(config.steps, false);
  assert.equal(config.intervalMs, 25);
});

test("panel numbers are integers in [1, 4]", () => {
  assert.equal(MIN_PANEL, 1);
  assert.equal(MAX_PANEL, 4);
  for (const value of ["0", "5", "1.5", "garbage", ""]) {
    assert.equal(num(value, 1), 1, `${value} should fall back`);
  }
  assert.equal(num("2", 1), 2);
  assert.equal(num("4", 1), 4);
});

test("the send interval falls back for invalid overrides", () => {
  assert.equal(loadConfig({ PUSHTODISPLAY_SEND_INTERVAL_MS: "-1" }).intervalMs, 1200);
  assert.equal(loadConfig({ PUSHTODISPLAY_SEND_INTERVAL_MS: "nope" }).intervalMs, 1200);
  assert.equal(loadConfig({ PUSHTODISPLAY_SEND_INTERVAL_MS: "0" }).intervalMs, 0);
});

test("agentLabel prefers the explicit label, then the cwd basename", () => {
  const config = loadConfig({ PUSHTODISPLAY_LABEL: " release " });
  assert.equal(agentLabel(config, "/Users/me/proj"), "release");
  assert.equal(agentLabel(loadConfig({}), "/Users/me/proj/"), "proj");
  assert.equal(agentLabel(loadConfig({}), "/"), "codex");
  assert.equal(agentLabel(loadConfig({}), ""), "codex");
});

test("cacheDir honors the test override, XDG, and HOME", () => {
  assert.equal(cacheDir({ PUSHTODISPLAY_CACHE_DIR: "/tmp/ptd" }), "/tmp/ptd");
  assert.equal(cacheDir({ XDG_CACHE_HOME: "/tmp/xdg" }), "/tmp/xdg/pushtodisplay/codex");
  assert.equal(cacheDir({ HOME: "/home/me" }), "/home/me/.cache/pushtodisplay/codex");
});

test("truncate normalizes whitespace and cuts at a word boundary", () => {
  assert.equal(truncate("  a\n   b  ", 100), "a b");
  const out = truncate("x".repeat(200), 20);
  assert.equal(out.length, 20);
  assert.ok(out.endsWith("…"));
  assert.ok(!out.includes("wor…"));
  assert.equal(truncate("hello", 20), "hello");
});

test("clock returns HH:MM:SS", () => {
  assert.match(clock(), /^\d{2}:\d{2}:\d{2}$/);
});
