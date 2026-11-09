/**
 * Adapter for the `pushtodisplay` CLI (`npm i pushtodisplay`).
 *
 * The CLI implements the OAuth 2.0 device-code flow against
 * https://idp.pushtodisplay.com. It stores credentials in the OS keychain
 * (macOS Keychain, Linux libsecret, Windows Credential Manager) and falls back
 * to ~/.config/pushtodisplay/credentials.json only when no keychain is
 * available, auto-refreshing the access token.
 *
 * Binary resolution, in order:
 *   1. `PUSHTODISPLAY_CLI` (an explicit path/executable; troubleshooting and tests),
 *   2. the `pushtodisplay` npm dependency installed next to this plugin
 *      (self-contained installs),
 *   3. a `pushtodisplay` binary on PATH (manual setups),
 *   4. `npx --yes pushtodisplay` (no install at all).
 */
import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync, statSync, accessSync, constants } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * @typedef {object} CliCommand
 * @property {string} exe Executable to spawn.
 * @property {string[]} prefix Extra argv before the CLI's own args.
 * @property {"env"|"bundled"|"path"|"npx"} source Where it came from.
 */

/**
 * The plugin root (one level above `lib/`). Codex sets PLUGIN_ROOT for plugin
 * hook commands; prefer it so an installed copy with a bundled dependency is
 * resolved from the same directory Codex loaded.
 */
export function pluginRoot(env = process.env) {
  const fromEnv = String(env.PLUGIN_ROOT ?? "").trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

/**
 * Find an executable on PATH without spawning it.
 *
 * @param {string} name
 * @param {string|undefined} pathEnv
 * @returns {string|null}
 */
export function findOnPath(name, pathEnv = process.env.PATH) {
  if (!pathEnv) return null;
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
      : [""];
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      try {
        if (!statSync(candidate).isFile()) continue;
        if (process.platform !== "win32") accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        // Not here; try the next directory.
      }
    }
  }
  return null;
}

/**
 * Read a package's `bin` entry for `pushtodisplay`.
 *
 * @param {string} packageJson
 * @returns {string|null}
 */
function packageBinPath(packageJson) {
  try {
    const pkg = JSON.parse(readFileSync(packageJson, "utf8"));
    const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.pushtodisplay;
    if (!bin) return null;
    const target = path.resolve(path.dirname(packageJson), bin);
    return existsSync(target) && statSync(target).isFile() ? target : null;
  } catch {
    return null;
  }
}

/**
 * Resolve how to invoke the CLI.
 *
 * @param {{env?: NodeJS.ProcessEnv, root?: string}} [opts]
 * @returns {CliCommand}
 */
export function resolveCli(opts = {}) {
  const env = opts.env ?? process.env;
  const root = opts.root ?? pluginRoot(env);

  const override = String(env.PUSHTODISPLAY_CLI ?? "").trim();
  if (override) return { exe: override, prefix: [], source: "env" };

  const bundled = packageBinPath(
    path.join(root, "node_modules", "pushtodisplay", "package.json"),
  );
  if (bundled) {
    return { exe: process.execPath, prefix: [bundled], source: "bundled" };
  }

  const onPath = findOnPath("pushtodisplay", env.PATH);
  if (onPath) return { exe: onPath, prefix: [], source: "path" };

  return {
    exe: process.platform === "win32" ? "npx.cmd" : "npx",
    prefix: ["--yes", "pushtodisplay"],
    source: "npx",
  };
}

/**
 * Run the CLI and return its output and exit code. Never throws for a non-zero
 * exit; callers decide what a failure means. `error` is present for spawn
 * failures (notably ENOENT).
 *
 * @param {string[]} args
 * @param {{timeoutMs?: number, env?: NodeJS.ProcessEnv, root?: string}} [opts]
 * @returns {Promise<{stdout: string, stderr: string, code: number, error?: unknown}>}
 */
export async function runCli(args, opts = {}) {
  const env = { ...process.env, ...(opts.env ?? {}) };
  const cmd = resolveCli({ env, root: opts.root });
  const timeout =
    opts.timeoutMs ?? (cmd.source === "npx" ? 60_000 : 15_000);
  try {
    const { stdout, stderr } = await execFileAsync(
      cmd.exe,
      [...cmd.prefix, ...args],
      {
        timeout,
        encoding: "utf8",
        maxBuffer: 4 * 1024 * 1024,
        env,
      },
    );
    return { stdout: String(stdout), stderr: String(stderr), code: 0 };
  } catch (error) {
    const e = /** @type {NodeJS.ErrnoException & {stdout?: string, stderr?: string, code?: number|string}} */ (
      error
    );
    return {
      stdout: String(e.stdout ?? ""),
      stderr: String(e.stderr ?? ""),
      code: typeof e.code === "number" ? e.code : 1,
      error,
    };
  }
}

/** Build the CLI argv for a board update payload. */
export function sendArgs(payload, boardId) {
  const args = ["send"];
  if (boardId) args.push("-b", boardId);
  args.push("-p", String(payload.panelId));
  if (payload.background) args.push("--background", payload.background);
  if (payload.density) args.push("--density", payload.density);
  for (const b of payload.blocks) args.push("--block", JSON.stringify(b));
  return args;
}

/**
 * Send a display update. Throws on failure (auth, network, or missing CLI).
 *
 * @param {import("./payloads.mjs").Payload} payload
 * @param {string} boardId
 * @param {{env?: NodeJS.ProcessEnv, root?: string, timeoutMs?: number}} [opts]
 */
export async function sendPayload(
  payload,
  boardId,
  opts = /** @type {{env?: NodeJS.ProcessEnv, root?: string, timeoutMs?: number}} */ ({}),
) {
  const result = await runCli(sendArgs(payload, boardId), opts);
  if (result.code !== 0) {
    const detail =
      result.stderr.trim() ||
      result.stdout.trim() ||
      `pushtodisplay send exited with code ${result.code}`;
    const err = new Error(detail);
    if (result.error) {
      // Preserve ENOENT/ETIMEDOUT for callers that classify failures.
      Object.assign(err, result.error);
    }
    throw err;
  }
}

/**
 * Probe auth state.
 *
 * Uses `auth status --json` (exit 0 = authenticated, non-zero = not). The CLI
 * reports effective auth — an expired access token with a valid refresh token
 * still counts as authenticated since it refreshes transparently. Falls back to
 * legacy text heuristics when the installed CLI predates JSON status output.
 *
 * @param {{env?: NodeJS.ProcessEnv, root?: string, timeoutMs?: number}} [opts]
 * @returns {Promise<{ok: boolean, missing: boolean}>}
 */
export async function probeAuth(opts = {}) {
  const result = await runCli(["auth", "status", "--json"], opts);

  if (isCliMissing(result.error)) return { ok: false, missing: true };

  if (result.stdout.trim()) {
    try {
      const parsed = JSON.parse(result.stdout);
      if (typeof parsed?.authenticated === "boolean") {
        return { ok: parsed.authenticated, missing: false };
      }
    } catch {
      // Not JSON — likely an older CLI that ignores --json; fall through.
    }
  }

  // Legacy heuristic (old CLI exits 0 whether logged in or not).
  const denied = /Not authenticated/i.test(result.stdout) || /\(expired\)/i.test(result.stdout);
  const confirmed =
    /Auth method/i.test(result.stdout) &&
    /All commands available/i.test(result.stdout);
  return { ok: result.code === 0 && confirmed && !denied, missing: false };
}

/** Boolean convenience wrapper around `probeAuth`. */
export async function authStatus(opts = {}) {
  return (await probeAuth(opts)).ok;
}

/** Spawn the CLI for the OAuth device-code flow, streaming stdout/stderr. */
export function spawnCli(
  args,
  opts = /** @type {{env?: NodeJS.ProcessEnv, root?: string}} */ ({}),
) {
  const env = { ...process.env, ...(opts.env ?? {}) };
  const cmd = resolveCli({ env, root: opts.root });
  return spawn(cmd.exe, [...cmd.prefix, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
    env,
  });
}

/** True when the failure looks like an auth problem (401/403/unauthorized). */
export function isAuthFailure(err) {
  return /unauthor|401|403|forbidden/i.test(String(err?.message ?? ""));
}

/** True when the underlying executable could not be spawned at all (ENOENT). */
export function isCliMissing(err) {
  return /** @type {NodeJS.ErrnoException} */ (err)?.code === "ENOENT";
}

/** Human-readable install hint shown when the CLI cannot be found at all. */
export function cliNotFoundMessage() {
  return [
    "Push To Display CLI not found.",
    "Install it with: npm i -g pushtodisplay",
    "(Repo-marketplace installs use npx automatically; for a local checkout run `npm install`.)",
  ].join(" ");
}
