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
 * The same actions are wrapped as plugin skills in `commands/`.
 */
import { spawn } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { saveGlobalAuth } from "../lib/auth-gate.mjs";
import {
  PUSHTODISPLAY_CLI_VERSION,
  authStatus,
  cliNotFoundMessage,
  isAuthFailure,
  isCliMissing,
  resolveCli,
  sendPayload,
  spawnCli,
} from "../lib/cli-adapter.mjs";
import { agentLabel, cacheDir, clock, loadConfig } from "../lib/config.mjs";
import { clearedMessage, testMessage } from "../lib/messages.mjs";
import { isSetupComplete, markSetupComplete, setupPath } from "../lib/setup-state.mjs";

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
 * @param {ReturnType<typeof loadConfig>} config
 * @returns {string}
 */
function configLines(config) {
  const cwd = process.cwd();
  return [
    `Board:    ${config.boardId || "default board"}`,
    `Panel:    ${config.panel}`,
    `Label:    ${agentLabel(config, cwd)}`,
  ].join("\n");
}

/**
 * @param {string[]} argv
 */
async function status(argv) {
  const env = process.env;
  const config = loadConfig(env);
  const authed = await authStatus({ env, pluginRoot, timeoutMs: 10_000 });
  const setup = isSetupComplete(env);
  const data = {
    cli: cliLabel(env),
    authenticated: authed,
    setup,
    setupFile: setupPath(env),
    boardId: config.boardId || null,
    panel: config.panel,
    label: agentLabel(config, process.cwd()),
    steps: config.steps,
    disabled: config.disabled,
    cacheDir: cacheDir(env),
  };
  if (argv.includes("--json")) {
    process.stdout.write(JSON.stringify(data, null, 2) + "\n");
    return;
  }
  process.stdout.write(
    [
      "Push To Display — codex-pushtodisplay",
      configLines(config),
      `Auth:     ${authed ? "logged in" : "not logged in — run: $pushtodisplay:setup"}`,
      `Setup:    ${setup ? "complete" : "not complete — run: $pushtodisplay:setup"}`,
    ].join("\n") + "\n",
  );
}

async function login() {
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

  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (value) => resolve(value ?? 1));
  }).catch((error) => {
    process.stderr.write(`Could not start the login flow: ${String(error)}\n`);
    return 1;
  });

  if (code !== 0) {
    process.stderr.write(`Login exited with code ${code}.\n`);
    process.stderr.write(
      "If this was a network or DNS error, run setup from a normal terminal with network access.\n",
    );
    process.exitCode = 1;
    return;
  }
  if (!sawOutput) process.stdout.write("Login finished.\n");

  const authed = await authStatus({ pluginRoot, timeoutMs: 10_000 });
  if (authed) {
    saveGlobalAuth(true);
    if (isSetupComplete()) {
      process.stdout.write("Logged in. Push To Display updates are enabled.\n");
    } else {
      process.stdout.write(
        "Logged in. Next: run `$pushtodisplay:setup` to finish this Codex integration.\n",
      );
    }
  } else {
    process.stderr.write(
      "The login flow finished but `auth status --json` still reports logged out.\n",
    );
    process.exitCode = 1;
  }
}

/**
 * Full setup for this Codex integration: authenticate if needed, prove the
 * board works with a test entry, then write the per-Codex setup marker.
 */
async function setup() {
  const env = process.env;
  const config = loadConfig(env);
  let authed = await authStatus({ env, pluginRoot, timeoutMs: 10_000 });

  if (!authed) {
    process.stdout.write("Push To Display is not logged in. Starting device-code login…\n");
    await login();
    if (process.exitCode === 1) {
      process.stderr.write(
        "Setup did not complete. If login hit a network/DNS error, run this setup command from a normal terminal with network access.\n",
      );
      return;
    }
    authed = await authStatus({ env, pluginRoot, timeoutMs: 10_000 });
    if (!authed) {
      process.stderr.write("Login finished but auth is still not available.\n");
      process.exitCode = 1;
      return;
    }
  } else {
    process.stdout.write("Push To Display is already authenticated.\n");
  }

  await sendTestOrClear("test");
  if (process.exitCode === 1) return;

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
    [
      `Setup complete for Codex. Board: ${record.boardId || "default board"}, panel ${record.panel}.`,
      "If you have not already, trust the pushtodisplay hooks in /hooks.",
    ].join("\n") + "\n",
  );
}

/**
 * @param {"test" | "clear"} action
 */
async function sendTestOrClear(action) {
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
      process.stderr.write("Not authenticated. Run: $pushtodisplay:setup\n");
    } else if (isCliMissing(error)) {
      process.stderr.write(`${cliNotFoundMessage()}\n`);
    } else {
      process.stderr.write(`Send failed: ${String(error)}\n`);
    }
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`Sent: ${lineText(payload)}\n`);
}

function usage() {
  process.stdout.write(
    [
      "Usage: node scripts/pushtodisplay.mjs <command> [--json]",
      "",
      "Commands:",
      "  setup    Log in if needed, send a test entry, and mark Codex setup complete.",
      "  login    Start the OAuth device-code login (opens the browser when possible).",
      "  status   Show the resolved CLI, board/panel/label, auth, and setup state.",
      "  test     Send a test entry to the configured panel.",
      "  clear    Write a `log cleared` entry to the configured panel.",
      "  help     Show this message.",
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
