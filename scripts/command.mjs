#!/usr/bin/env node
/**
 * The implementation behind the four Push To Display skills.
 *
 * The skills ask Codex to run this script and relay its output. The script
 * always exits 0: a not-authenticated or offline board is a message to read,
 * not a reason to abort the session.
 *
 *   node scripts/command.mjs login
 *   node scripts/command.mjs status
 *   node scripts/command.mjs test
 *   node scripts/command.mjs clear
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { cacheDir, clock, labelFor, loadConfig } from "../lib/config.mjs";
import {
  cliNotFoundMessage,
  isAuthFailure,
  probeAuth,
  resolveCli,
  sendPayload,
} from "../lib/cli-adapter.mjs";
import { bestDeviceUrl, parseDeviceAuth } from "../lib/device-code.mjs";
import {
  clearedMessage,
  payloadText,
  testMessage,
} from "../lib/messages.mjs";
import { loginLog, writeAuth } from "../lib/state.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.join(SCRIPT_DIR, "login-worker.mjs");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function print(text = "") {
  process.stdout.write(text + "\n");
}

function describeCli(cmd) {
  if (cmd.source === "bundled") return "bundled dependency";
  if (cmd.source === "path") return `PATH (${cmd.exe})`;
  if (cmd.source === "env") return `PUSHTODISPLAY_CLI (${cmd.exe})`;
  return "not found";
}

function boardLabel(boardId) {
  return boardId || "default board";
}

/** Open a URL in the platform browser, best effort. */
function openBrowser(url) {
  const [exe, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  try {
    const child = spawn(exe, args, { detached: true, stdio: "ignore" });
    // A missing browser is not an error: the URL is printed anyway.
    child.on("error", () => {});
    child.unref();
  } catch {
    // No browser: the URL is printed anyway.
  }
}

/** Poll the login log until the URL/code appears or the timeout elapses. */
async function waitForDeviceAuth(logPath, timeoutMs) {
  const started = Date.now();
  let text = "";
  while (Date.now() - started < timeoutMs) {
    try {
      text = await readFile(logPath, "utf8");
    } catch {
      text = "";
    }
    const parsed = parseDeviceAuth(text);
    if (bestDeviceUrl(parsed) && parsed.code) return parsed;
    await sleep(100);
  }
  return parseDeviceAuth(text);
}

async function login() {
  const already = await probeAuth();
  if (already.ok) {
    print("Push To Display is already authenticated.");
    return;
  }
  if (already.missing) {
    print(cliNotFoundMessage());
    return;
  }

  const logPath = loginLog(process.env);
  await mkdir(path.dirname(logPath), { recursive: true, mode: 0o700 });
  await writeFile(logPath, "", { encoding: "utf8", mode: 0o600 });

  const worker = spawn(process.execPath, [WORKER, logPath], {
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  worker.on("error", () => {});
  worker.unref();

  const parsed = await waitForDeviceAuth(logPath, 8000);
  const url = bestDeviceUrl(parsed);

  if (url) {
    openBrowser(url);
    print("Push To Display login started.");
    if (parsed.code) print(`Code: ${parsed.code}`);
    print(`Open: ${url}`);
    if (parsed.code) print("Enter the code in the browser, then approve the login.");
    print("Run $pushtodisplay-status when the browser says it is done.");
  } else {
    print("Push To Display login started, but the device code has not appeared yet.");
    print(`Check ${logPath} or run: pushtodisplay auth login --device-code`);
    print("Then run $pushtodisplay-status.");
  }
}

async function status() {
  const config = loadConfig();
  const cmd = resolveCli();
  const auth = await probeAuth();
  await writeAuth({ status: auth.ok ? "ok" : "bad", at: Date.now() });

  print("Push To Display status");
  print(`  Auth: ${auth.ok ? "authenticated" : auth.missing ? "CLI not found" : "not authenticated"}`);
  print(`  CLI: ${describeCli(cmd)}`);
  print(`  Board: ${boardLabel(config.boardId)}`);
  print(`  Panel: ${config.panel}`);
  print(`  Label: ${labelFor(process.env, process.cwd())}`);
  print(`  Steps: ${config.steps ? "on" : "off"}`);
  print(`  Disabled: ${config.disabled ? "yes (PUSHTODISPLAY_DISABLED=1)" : "no"}`);
  print(`  Cache: ${cacheDir(process.env)}`);
  if (auth.missing) print(`  ${cliNotFoundMessage()}`);
  if (!auth.ok && !auth.missing) {
    print("  Run $pushtodisplay-login to authenticate.");
  }
}

async function test() {
  const config = loadConfig();
  if (config.disabled) {
    print("Push To Display is disabled (PUSHTODISPLAY_DISABLED=1).");
    return;
  }
  const auth = await probeAuth();
  if (!auth.ok) {
    await writeAuth({ status: "bad", at: Date.now() });
    print(
      auth.missing
        ? `Cannot send: ${cliNotFoundMessage()}`
        : "Not authenticated — run $pushtodisplay-login first.",
    );
    return;
  }

  const agent = labelFor(process.env, process.cwd());
  const payload = testMessage({
    panelId: config.panel,
    agent,
    wall: clock(),
  });
  try {
    await sendPayload(payload, config.boardId);
    print(
      `Test entry sent to ${boardLabel(config.boardId)}, panel ${config.panel}, as ${agent}.`,
    );
  } catch (err) {
    if (isAuthFailure(err)) await writeAuth({ status: "bad", at: Date.now() });
    print(`Test entry failed: ${/** @type {Error} */ (err)?.message ?? err}`);
  }
}

async function clear() {
  const config = loadConfig();
  if (config.disabled) {
    print("Push To Display is disabled (PUSHTODISPLAY_DISABLED=1).");
    return;
  }
  const auth = await probeAuth();
  if (!auth.ok) {
    await writeAuth({ status: "bad", at: Date.now() });
    print(
      auth.missing
        ? `Cannot send: ${cliNotFoundMessage()}`
        : "Not authenticated — run $pushtodisplay-login first.",
    );
    return;
  }

  const agent = labelFor(process.env, process.cwd());
  const payload = clearedMessage({
    panelId: config.panel,
    agent,
    wall: clock(),
  });
  try {
    await sendPayload(payload, config.boardId);
    print(`Wrote \`${payloadText(payload).trim()}\` to ${boardLabel(config.boardId)}.`);
  } catch (err) {
    if (isAuthFailure(err)) await writeAuth({ status: "bad", at: Date.now() });
    print(`Could not write the clear entry: ${/** @type {Error} */ (err)?.message ?? err}`);
  }
}

async function main() {
  const command = process.argv[2];
  switch (command) {
    case "login":
      await login();
      break;
    case "status":
      await status();
      break;
    case "test":
      await test();
      break;
    case "clear":
      await clear();
      break;
    default:
      print("Usage: node scripts/command.mjs <login|status|test|clear>");
  }
}

main().catch((err) => {
  // Commands always exit 0 so the injected output reaches Codex.
  print(`Push To Display command failed: ${/** @type {Error} */ (err)?.message ?? err}`);
});
