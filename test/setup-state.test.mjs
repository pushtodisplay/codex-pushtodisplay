// @ts-check
/** Per-Codex setup marker. */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";

import {
  SETUP_VERSION,
  isSetupComplete,
  loadSetupRecord,
  markSetupComplete,
  setupPath,
} from "../lib/setup-state.mjs";

/** @returns {{ root: string, env: Record<string, string>, cleanup: () => void }} */
function tempEnv() {
  const root = mkdtempSync(path.join(tmpdir(), "ptd-setup-"));
  return {
    root,
    env: { PUSHTODISPLAY_CACHE_DIR: root },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("setup is incomplete until the marker is written", () => {
  const { env, cleanup } = tempEnv();
  try {
    assert.equal(isSetupComplete(env), false);
    const record = markSetupComplete(
      { boardId: "board-1", panel: 2, label: "release", cliVersion: "0.1.19" },
      env,
    );
    assert.equal(record.version, SETUP_VERSION);
    assert.equal(record.boardId, "board-1");
    assert.equal(record.panel, 2);
    assert.equal(record.label, "release");
    assert.equal(isSetupComplete(env), true);
    assert.deepEqual(loadSetupRecord(env), record);
    const onDisk = JSON.parse(readFileSync(setupPath(env), "utf8"));
    assert.equal(onDisk.completedAt, record.completedAt);
  } finally {
    cleanup();
  }
});

test("a malformed or old setup marker is ignored", () => {
  const { root, env, cleanup } = tempEnv();
  try {
    writeFileSync(path.join(root, "setup.json"), "not json");
    assert.equal(isSetupComplete(env), false);
    writeFileSync(path.join(root, "setup.json"), JSON.stringify({ version: 0, completedAt: 1 }));
    assert.equal(isSetupComplete(env), false);
    writeFileSync(path.join(root, "setup.json"), JSON.stringify({ version: SETUP_VERSION }));
    assert.equal(isSetupComplete(env), false);
  } finally {
    cleanup();
  }
});
