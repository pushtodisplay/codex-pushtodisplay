// @ts-check
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import test from "node:test";

import {
  PUSHTODISPLAY_CLI_VERSION,
  authCheck,
  authStatus,
  findOnPath,
  isAuthFailure,
  isCliMissing,
  resolveCli,
  sendArgs,
} from "../lib/cli-adapter.mjs";

/**
 * @param {string} body
 * @param {number} [exitCode]
 * @returns {{ root: string, bin: string, cleanup: () => void }}
 */
function fakeCli(body = "", exitCode = 0) {
  const root = mkdtempSync(path.join(tmpdir(), "ptd-cli-"));
  const bin = path.join(root, "pushtodisplay");
  writeFileSync(
    bin,
    `#!${process.execPath}\n${body}\nprocess.exit(${exitCode});\n`,
  );
  chmodSync(bin, 0o755);
  return {
    root,
    bin,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

/** @returns {{ root: string, cleanup: () => void }} */
function emptyRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "ptd-root-"));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("sendArgs maps a payload to CLI argv", () => {
  const payload = {
    panelId: 2,
    background: "#1a5276",
    density: /** @type {const} */ ("compact"),
    blocks: [{ text: "hi", color: "#ffffff" }],
  };
  assert.deepEqual(sendArgs(payload, "board-1"), [
    "send",
    "-b",
    "board-1",
    "-p",
    "2",
    "--background",
    "#1a5276",
    "--density",
    "compact",
    "--block",
    '{"text":"hi","color":"#ffffff"}',
  ]);
  assert.deepEqual(sendArgs({ panelId: 1, blocks: [{ text: "x" }] }, ""), [
    "send",
    "-p",
    "1",
    "--block",
    '{"text":"x"}',
  ]);
});

test("resolveCli prefers an explicit PUSHTODISPLAY_CLI", () => {
  const fake = fakeCli();
  try {
    const command = resolveCli({ env: { PATH: "", PUSHTODISPLAY_CLI: fake.bin } });
    assert.equal(command.source, "env");
    assert.equal(command.exe, path.resolve(fake.bin));
  } finally {
    fake.cleanup();
  }
});

test("resolveCli finds a bundled npm dependency", () => {
  const root = emptyRoot();
  try {
    const pkgRoot = path.join(root.root, "node_modules", "pushtodisplay");
    mkdirSync(pkgRoot, { recursive: true });
    writeFileSync(path.join(pkgRoot, "cli.js"), "// cli\n");
    writeFileSync(
      path.join(pkgRoot, "package.json"),
      JSON.stringify({
        name: "pushtodisplay",
        version: "0.0.0",
        bin: { pushtodisplay: "./cli.js" },
      }),
    );
    const command = resolveCli({ env: { PATH: "" }, pluginRoot: root.root, cwd: root.root });
    assert.equal(command.source, "bundled");
    assert.equal(command.exe, process.execPath);
    assert.deepEqual(command.prefix, [path.join(pkgRoot, "cli.js")]);
  } finally {
    root.cleanup();
  }
});

test("resolveCli falls back to PATH, then to npx", () => {
  const fake = fakeCli();
  const root = emptyRoot();
  try {
    const onPath = resolveCli({ env: { PATH: fake.root }, pluginRoot: root.root, cwd: root.root });
    assert.equal(onPath.source, "path");
    assert.equal(onPath.exe, fake.bin);

    const viaNpx = resolveCli({ env: { PATH: "" }, pluginRoot: root.root, cwd: root.root });
    assert.equal(viaNpx.source, "npx");
    assert.equal(viaNpx.exe, "npx");
    assert.deepEqual(viaNpx.prefix, ["--yes", `pushtodisplay@${PUSHTODISPLAY_CLI_VERSION}`]);
  } finally {
    fake.cleanup();
    root.cleanup();
  }
});

test("findOnPath locates an executable and rejects a missing one", () => {
  const fake = fakeCli();
  try {
    assert.equal(findOnPath("pushtodisplay", { PATH: fake.root }), fake.bin);
    assert.equal(findOnPath("pushtodisplay", { PATH: "" }), null);
  } finally {
    fake.cleanup();
  }
});

test("authCheck reads the JSON contract as a tri-state", async () => {
  const authed = fakeCli(
    'process.stdout.write(JSON.stringify({authenticated:true,method:"oauth"})+"\\n");',
  );
  const denied = fakeCli(
    'process.stdout.write(JSON.stringify({authenticated:false,method:null})+"\\n");',
  );
  const root = emptyRoot();
  try {
    const authedCheck = await authCheck({
      env: { PATH: authed.root },
      pluginRoot: root.root,
      cwd: root.root,
    });
    assert.deepEqual(authedCheck, { state: "authenticated", reason: null });
    assert.equal(
      await authStatus({ env: { PATH: authed.root }, pluginRoot: root.root, cwd: root.root }),
      true,
    );

    const deniedCheck = await authCheck({
      env: { PATH: denied.root },
      pluginRoot: root.root,
      cwd: root.root,
    });
    assert.deepEqual(deniedCheck, { state: "unauthenticated", reason: null });
    assert.equal(
      await authStatus({ env: { PATH: denied.root }, pluginRoot: root.root, cwd: root.root }),
      false,
    );
  } finally {
    authed.cleanup();
    denied.cleanup();
    root.cleanup();
  }
});

test("a failed probe or missing CLI is unavailable, never logged out", async () => {
  const network = fakeCli('process.stderr.write("Error: getaddrinfo ENOTFOUND idp\\n");', 7);
  const root = emptyRoot();
  try {
    const networkCheck = await authCheck({
      env: { PATH: network.root },
      pluginRoot: root.root,
      cwd: root.root,
    });
    assert.equal(networkCheck.state, "unavailable");
    assert.ok(networkCheck.reason);

    const missingCheck = await authCheck({
      env: { PATH: "" },
      pluginRoot: root.root,
      cwd: root.root,
    });
    assert.equal(missingCheck.state, "unavailable");
    assert.ok(missingCheck.reason);
  } finally {
    network.cleanup();
    root.cleanup();
  }
});

test("authStatus falls back to legacy text and treats unreadable output as unavailable", async () => {
  const legacyOk = fakeCli(
    'process.stdout.write("Auth method: OAuth (JWT)\\nAll commands available (send, boards, devices).\\n");',
  );
  const legacyDenied = fakeCli('process.stdout.write("Not authenticated. Run auth login.\\n");');
  const unknown = fakeCli('process.stdout.write("something new\\n");');
  const root = emptyRoot();
  try {
    assert.equal(
      await authStatus({ env: { PATH: legacyOk.root }, pluginRoot: root.root, cwd: root.root }),
      true,
    );
    assert.equal(
      await authStatus({ env: { PATH: legacyDenied.root }, pluginRoot: root.root, cwd: root.root }),
      false,
    );
    assert.equal(
      (await authCheck({ env: { PATH: unknown.root }, pluginRoot: root.root, cwd: root.root }))
        .state,
      "unavailable",
    );
    assert.equal(
      (await authCheck({ env: { PATH: "" }, pluginRoot: root.root, cwd: root.root })).state,
      "unavailable",
    );
  } finally {
    legacyOk.cleanup();
    legacyDenied.cleanup();
    unknown.cleanup();
    root.cleanup();
  }
});

test("error classification", () => {
  assert.equal(isAuthFailure(new Error("401 Unauthorized")), true);
  assert.equal(isAuthFailure(new Error("403 Forbidden")), true);
  assert.equal(isAuthFailure(new Error("ECONNREFUSED")), false);
  assert.equal(isCliMissing(Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" })), true);
  assert.equal(isCliMissing(new Error("spawn ENOENT")), false);
});
