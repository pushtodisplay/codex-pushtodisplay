import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import {
  findOnPath,
  pluginRoot,
  resolveCli,
  sendArgs,
  probeAuth,
} from "../lib/cli-adapter.mjs";

const root = path.resolve(import.meta.dirname, "..");

test("PLUGIN_ROOT wins when it points at a real directory", () => {
  assert.equal(pluginRoot({ PLUGIN_ROOT: root }), root);
});

test("resolveCli prefers the explicit PUSHTODISPLAY_CLI override", () => {
  const cmd = resolveCli({ env: { PUSHTODISPLAY_CLI: "/opt/bin/pushtodisplay" } });
  assert.deepEqual(cmd, { exe: "/opt/bin/pushtodisplay", prefix: [], source: "env" });
});

test("resolveCli uses the bundled dependency next to the plugin", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "p2d-cli-"));
  const bin = path.join(dir, "node_modules", "pushtodisplay", "bin.js");
  mkdirSync(path.dirname(bin), { recursive: true });
  writeFileSync(bin, "#!/usr/bin/env node\n");
  writeFileSync(
    path.join(dir, "node_modules", "pushtodisplay", "package.json"),
    JSON.stringify({ name: "pushtodisplay", bin: { pushtodisplay: "./bin.js" } }),
  );
  const cmd = resolveCli({ env: {}, root: dir });
  assert.equal(cmd.source, "bundled");
  assert.equal(cmd.exe, process.execPath);
  assert.deepEqual(cmd.prefix, [bin]);
});

test("resolveCli falls back to PATH, then npx", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "p2d-path-"));
  const bin = path.join(dir, "pushtodisplay");
  writeFileSync(bin, "#!/bin/sh\n");
  chmodSync(bin, 0o755);
  const onPath = resolveCli({ env: { PATH: dir }, root: dir });
  assert.equal(onPath.source, "path");
  assert.equal(onPath.exe, bin);

  const empty = mkdtempSync(path.join(os.tmpdir(), "p2d-empty-"));
  const none = resolveCli({ env: { PATH: empty }, root: path.join(empty, "missing") });
  assert.equal(none.source, "npx");
  assert.deepEqual(none.prefix, ["--yes", "pushtodisplay"]);
});

test("findOnPath requires an executable file", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "p2d-find-"));
  const bin = path.join(dir, "pushtodisplay");
  writeFileSync(bin, "no");
  assert.equal(findOnPath("pushtodisplay", dir), null);
  chmodSync(bin, 0o755);
  assert.equal(findOnPath("pushtodisplay", dir), bin);
});

test("sendArgs carries board, panel, and every block", () => {
  const args = sendArgs(
    {
      panelId: 3,
      background: "#123456",
      density: "compact",
      blocks: [{ text: "a", color: "#fff" }],
    },
    "board-1",
  );
  assert.deepEqual(args.slice(0, 6), [
    "send",
    "-b",
    "board-1",
    "-p",
    "3",
    "--background",
  ]);
  assert.ok(args.includes("--density"));
  assert.ok(args.includes("--block"));
  assert.equal(args.at(-1), JSON.stringify({ text: "a", color: "#fff" }));
});

test("probeAuth reads the JSON status contract", async () => {
  const fake = path.join(root, "fixtures", "fake-cli.mjs");
  assert.ok(existsSync(fake));
  assert.deepEqual(await probeAuth({ env: { PUSHTODISPLAY_CLI: fake, FAKE_CLI_AUTH: "yes" } }), {
    ok: true,
    missing: false,
  });
  assert.deepEqual(await probeAuth({ env: { PUSHTODISPLAY_CLI: fake, FAKE_CLI_AUTH: "no" } }), {
    ok: false,
    missing: false,
  });
});
