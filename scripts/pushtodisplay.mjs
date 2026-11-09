#!/usr/bin/env node
// @ts-check
/**
 * Small operator CLI for codex-pushtodisplay.
 *
 * Codex plugins bundle skills, MCP servers, and hooks; they do not expose a
 * shell-backed slash command. This script is the supported command surface:
 *
 *   node scripts/pushtodisplay.mjs login
 *   node scripts/pushtodisplay.mjs status
 *   node scripts/pushtodisplay.mjs test
 *   node scripts/pushtodisplay.mjs clear
 *
 * Setup and login are host-side actions: they need the OS credential store and
 * the identity/API network. Status is safe to run inside Codex's sandbox and
 * reports a failed auth probe as "not checked", not "logged out".
 */
import { spawn } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { saveGlobalAuth } from "../lib/auth-gate.mjs";
import {
  PUSHTODISPLAY_CLI_VERSION,
  authCheck,
  cliNotFoundMessage,
  isAuthFailure,
  isCliMissing,
  resolveCli,
  sendPayload,
  spawnCli,
} from "../lib/cli-adapter.mjs";
import { agentLabel, cacheDir, clock, loadConfig } from "../lib/config.mjs";
import { clearedMessage, testMessage } from "../lib/messages.mjs";
import {
  isSetupComplete,
  loadSetupRecord,
  markSetupComplete,
  setupPath,
} from "../lib/setup-state.mjs";
import { buildStatus, formatStatus } from "../lib/status.mjs";

const pluginRoot =
  process.env.PLUGIN_ROOT ||
  process.env.CLAUDE_PLUGIN_ROOT ||
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * @param {import("../lib/payloads.mjs").Payload} payload
 * @returns {string}
 */
function lineText(payload) {
  return payload.blocks.map((block) => block.text).join("");
}

/**
 * Open a URL in the user's browser when the environment suggests one exists.
 * @param {string} url
 */
function openBrowser(url) {
  if (process.env.PUSHTODISPLAY_NO_BROWSER === "1") return;
  /** @type {import("node:child_process").ChildProcess | null} */
  let child = null;
  if (process.platform === "darwin") {
    child = spawn("open", [url], { stdio: "ignore", detached: true });
  } else if (process.platform === "win32") {
    child = spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true });
  } else if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) {
    child = spawn("xdg-open", [url], { stdio: "ignore", detached: true });
  }
  child?.on("error", () => {});
  child?.unref();
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
function cliLabel(env) {
  const command = resolveCli({ env, pluginRoot });
  if (command.source === "npx") return `${command.display} (not installed)`;
  return `${command.display} (${command.source})`;
}

/**
 * Network-shaped failures are expected when the helper is run inside Codex's
 * sandbox. Keep the recovery hint to one sentence.
 * @param {unknown} error
 * @returns {boolean}
 */
function isNetworkFailure(error) {
  const err = /** @type {{ message?: string, stderr?: string }} */ (error);
  return /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|fetch failed|getaddrinfo|socket hang up|network/i.test(
    `${err?.message ?? ""} ${err?.stderr ?? ""}`,
  );
}

/**
 * One message for a sandboxed setup attempt. Setup is a host-side action:
 * either run it in a normal terminal or approve Codex's escalated command once.
 * @returns {string}
 */
function setupUnavailableMessage() {
  return (
    "Setup could not check Push To Display here because this command cannot reach the credential store or network. " +
    "Run setup from a normal terminal, or approve Codex's escalated command once.\n"
  );
}

/**
 * @param {string[]} argv
 */
async function status(argv) {
  const env = process.env;
  const config = loadConfig(env);
  const auth = await authCheck({ env, pluginRoot, timeoutMs: 10_000 });
  const data = buildStatus({
    config,
    cwd: process.cwd(),
    cli: cliLabel(env),
    auth,
    setupRecord: loadSetupRecord(env),
    setupFile: setupPath(env),
    cacheDir: cacheDir(env),
  });
  if (argv.includes("--json")) {
    process.stdout.write(JSON.stringify(data, null, 2) + "\n");
    return;
  }
  process.stdout.write(formatStatus(data));
}

/**
 * Start the device-code login. Returns a single result; the caller must not add
 * a second network-recovery hint. `quietSuccess` lets setup print its own final
 * outcome instead of both "Logged in" and "Setup complete".
 * @param {{ quietSuccess?: boolean }} [opts]
 * @returns {Promise<{ ok: boolean }>}
 */
async function login(opts = {}) {
  process.stdout.write("Starting Push To Display device-code login…\n");
  const child = spawnCli(["auth", "login", "--device-code"], { pluginRoot });
  let opened = false;
  let sawOutput = false;

  /**
   * @param {Buffer | string} chunk
   * @param {NodeJS.WriteStream} stream
   */
  const handle = (chunk, stream) => {
    const text = String(chunk);
    sawOutput = true;
    stream.write(text);
    const urls = text.match(/https?:\/\/[^\s<>"']+/g) ?? [];
    const url = urls.find((candidate) => /device|activate|login|auth/i.test(candidate)) ?? urls[0];
    if (url && !opened) {
      opened = true;
      process.stdout.write(`\nOpening ${url}\n`);
      openBrowser(url);
    }
  };

  child.stdout?.on("data", (chunk) => handle(chunk, process.stdout));
  child.stderr?.on("data", (chunk) => handle(chunk, process.stderr));

  /** @type {NodeJS.ErrnoException | null} */
  let spawnError = null;
  const code = await new Promise((resolve) => {
    child.on("error", (error) => {
      spawnError = error;
      resolve(null);
    });
    child.on("close", (value) => resolve(value ?? 1));
  });

  if (spawnError) {
    process.stderr.write(
      isCliMissing(spawnError)
        ? `${cliNotFoundMessage()}\n`
        : `Login could not start: ${String(spawnError)}. Run setup from a normal terminal.\n`,
    );
    process.exitCode = 1;
    return { ok: false };
  }

  if (code !== 0) {
    process.stderr.write(
      `Login failed (exit ${code}). Check network access or run setup from a normal terminal.\n`,
    );
    process.exitCode = 1;
    return { ok: false };
  }
  if (!sawOutput) process.stdout.write("Login finished.\n");

  const auth = await authCheck({ env: process.env, pluginRoot, timeoutMs: 10_000 });
  if (auth.state === "authenticated") {
    saveGlobalAuth(true);
    if (!opts.quietSuccess) {
      if (isSetupComplete()) {
        process.stdout.write("Logged in. Push To Display updates are enabled.\n");
      } else {
        process.stdout.write(
          "Logged in. Next: run `$pushtodisplay:setup` from a normal terminal to finish setup.\n",
        );
      }
    }
    return { ok: true };
  }

  if (auth.state === "unavailable") {
    process.stderr.write(
      auth.reason === "the bundled CLI could not be started"
        ? `Login finished, but ${cliNotFoundMessage()}\n`
        : "Login finished, but auth could not be verified here (sandbox/network/keychain). Run setup from a normal terminal to finish.\n",
    );
  } else {
    process.stderr.write(
      "Login finished, but Push To Display still reports logged out. Run setup again from a normal terminal.\n",
    );
  }
  process.exitCode = 1;
  return { ok: false };
}

/**
 * Full setup for this Codex integration: authenticate if needed, prove the
 * board works with a test entry, then write the per-Codex setup marker.
 *
 * This is a host-side action. If the auth probe cannot run (the usual case
 * inside Codex's sandbox), do not attempt a login that will fail the same way;
 * print one recovery instruction and stop.
 */
async function setup() {
  const env = process.env;
  const config = loadConfig(env);
  const auth = await authCheck({ env, pluginRoot, timeoutMs: 10_000 });

  if (auth.state === "unavailable") {
    process.stderr.write(
      auth.reason === "the bundled CLI could not be started"
        ? `${cliNotFoundMessage()}\n`
        : setupUnavailableMessage(),
    );
    process.exitCode = 1;
    return;
  }

  if (auth.state === "unauthenticated") {
    const result = await login({ quietSuccess: true });
    if (!result.ok) return;
  }

  const sent = await sendTestOrClear("test", { announce: false });
  if (process.exitCode === 1 || !sent) return;

  const record = markSetupComplete(
    {
      boardId: config.boardId,
      panel: config.panel,
      label: agentLabel(config, process.cwd()),
      cliVersion: PUSHTODISPLAY_CLI_VERSION,
    },
    env,
  );
  process.stdout.write(
    `Push To Display setup complete for Codex. Board: ${record.boardId || "default board"}, panel ${record.panel}. Test entry: ${sent}.\n`,
  );
}

/**
 * @param {"test" | "clear"} action
 * @param {{ announce?: boolean }} [opts]
 * @returns {Promise<string | null>}
 */
async function sendTestOrClear(action, opts = {}) {
  const config = loadConfig();
  const payload =
    action === "test"
      ? testMessage({ panelId: config.panel, agent: agentLabel(config, process.cwd()), wall: clock() })
      : clearedMessage({
          panelId: config.panel,
          agent: agentLabel(config, process.cwd()),
          wall: clock(),
        });
  try {
    await sendPayload(payload, config.boardId, { pluginRoot });
  } catch (error) {
    if (isAuthFailure(error)) {
      process.stderr.write(
        "Not authenticated. Run: $pushtodisplay:setup from a normal terminal.\n",
      );
    } else if (isCliMissing(error)) {
      process.stderr.write(`${cliNotFoundMessage()}\n`);
    } else if (isNetworkFailure(error)) {
      process.stderr.write(
        "Send failed: Push To Display could not be reached here (sandbox/network). Run this from a normal terminal.\n",
      );
    } else {
      process.stderr.write(`Send failed: ${String(error)}\n`);
    }
    process.exitCode = 1;
    return null;
  }
  const text = lineText(payload);
  if (opts.announce !== false) process.stdout.write(`Sent: ${text}\n`);
  return text;
}

function usage() {
  process.stdout.write(
    [
      "Usage: node scripts/pushtodisplay.mjs <command> [--json]",
      "",
      "Commands:",
      "  setup    Log in if needed, send a test entry, and mark Codex setup complete.",
      "  login    Start the OAuth device-code login (opens the browser when possible).",
      "  status   Show the resolved CLI, board/panel/label, setup marker, and auth state.",
      "  test     Send a test entry to the configured panel.",
      "  clear    Write a `log cleared` entry to the configured panel.",
      "  help     Show this message.",
      "",
      "Setup and login need the host credential store and network. Run them from",
      "a normal terminal, or approve Codex's escalated command once. Status is",
      "safe inside Codex's sandbox and reports auth it cannot check as unchecked.",
      "",
      "Environment: PUSHTODISPLAY_BOARD_ID, PUSHTODISPLAY_PANEL (1-4),",
      "PUSHTODISPLAY_LABEL, PUSHTODISPLAY_STEPS=0, PUSHTODISPLAY_DISABLED=1.",
    ].join("\n") + "\n",
  );
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0] ?? "help";
  switch (command) {
    case "setup":
      await setup();
      break;
    case "login":
      await login();
      break;
    case "status":
      await status(argv);
      break;
    case "test":
      await sendTestOrClear("test");
      break;
    case "clear":
      await sendTestOrClear("clear");
      break;
    case "help":
    case "--help":
    case "-h":
      usage();
      break;
    default:
      process.stderr.write(`Unknown command: ${command}\n\n`);
      usage();
      process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`codex-pushtodisplay: ${String(error)}\n`);
  process.exitCode = 1;
});
