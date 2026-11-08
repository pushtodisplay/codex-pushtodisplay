// @ts-check
/**
 * Adapter for the `pushtodisplay` CLI (`npm i pushtodisplay`).
 *
 * The CLI implements the OAuth 2.0 device-code flow against
 * https://idp.pushtodisplay.com. It stores credentials in the OS keychain and
 * auto-refreshes the access token.
 *
 * Binary resolution, in order:
 *   1. an explicit PUSHTODISPLAY_CLI path (advanced/testing),
 *   2. a bundled `pushtodisplay` npm dependency next to the plugin,
 *   3. a `pushtodisplay` binary on PATH,
 *   4. `npx --yes pushtodisplay` as a last resort.
 */
import { execFile, spawn } from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";

/** @typedef {import("./payloads.mjs").Payload} Payload */

/** @typedef {"env" | "bundled" | "path" | "npx"} CliSource */

/**
 * @typedef {object} CliCommand
 * @property {string} exe Executable to spawn.
 * @property {string[]} prefix Extra argv before the CLI's own args.
 * @property {CliSource} source Where the command came from.
 * @property {string} display Human-readable invocation for diagnostics.
 */

/**
 * @param {string} file
 * @returns {boolean}
 */
function isExecutable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * Find an executable on PATH.
 * @param {string} name
 * @param {NodeJS.ProcessEnv} env
 * @returns {string | null}
 */
export function findOnPath(name, env = process.env) {
  if (name.includes("/") || name.includes("\\")) {
    return isExecutable(name) ? path.resolve(name) : null;
  }
  const pathValue = env.PATH ?? env.Path ?? "";
  const exts =
    process.platform === "win32"
      ? (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean)
      : [""];
  for (const dir of pathValue.split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      if (isExecutable(candidate)) return candidate;
    }
  }
  return null;
}

/**
 * @param {string} pkgJsonPath
 * @returns {{ exe: string, prefix: string[], source: CliSource, display: string } | null}
 */
function commandFromPackage(pkgJsonPath) {
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
    const root = path.dirname(pkgJsonPath);
    const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.pushtodisplay;
    if (!bin) return null;
    const target = path.resolve(root, bin);
    if (!fs.existsSync(target)) return null;
    return {
      exe: process.execPath,
      prefix: [target],
      source: "bundled",
      display: `${process.execPath} ${target}`,
    };
  } catch {
    return null;
  }
}

/**
 * Resolve an installed package through Node's own module lookup. This handles
 * hoisted dependencies (npm workspaces, a global install) that a plain
 * `node_modules` scan of the plugin root would miss.
 * @param {string} root
 * @returns {{ exe: string, prefix: string[], source: CliSource, display: string } | null}
 */
function bundledFromRequire(root) {
  try {
    const req = createRequire(path.join(root, "package.json"));
    try {
      return commandFromPackage(req.resolve("pushtodisplay/package.json"));
    } catch {
      const entry = req.resolve("pushtodisplay");
      let dir = path.dirname(entry);
      for (let i = 0; i < 8; i += 1) {
        const candidate = path.join(dir, "package.json");
        try {
          const pkg = JSON.parse(fs.readFileSync(candidate, "utf8"));
          if (pkg.name === "pushtodisplay") return commandFromPackage(candidate);
        } catch {
          // Keep walking up.
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    }
  } catch {
    // Not installed; fall through.
  }
  return null;
}

/**
 * Look for a bundled dependency in the plugin root and the current working
 * directory (a local checkout runs hooks from either).
 * @param {string} pluginRoot
 * @returns {{ exe: string, prefix: string[], source: CliSource, display: string } | null}
 */
export function findBundledCli(pluginRoot) {
  const roots = [pluginRoot, process.cwd()];
  for (const root of roots) {
    if (!root) continue;
    const required = bundledFromRequire(root);
    if (required) return required;
    const found = commandFromPackage(
      path.join(root, "node_modules", "pushtodisplay", "package.json"),
    );
    if (found) return found;
  }
  return null;
}

/**
 * Resolve how to invoke the CLI.
 * @param {{ env?: NodeJS.ProcessEnv, pluginRoot?: string }} [opts]
 * @returns {CliCommand}
 */
export function resolveCli(opts = {}) {
  const env = opts.env ?? process.env;
  const pluginRoot =
    opts.pluginRoot ?? env.PLUGIN_ROOT ?? env.CLAUDE_PLUGIN_ROOT ?? process.cwd();

  const explicit = env.PUSHTODISPLAY_CLI;
  if (explicit && isExecutable(explicit)) {
    return {
      exe: path.resolve(explicit),
      prefix: [],
      source: "env",
      display: path.resolve(explicit),
    };
  }

  const bundled = findBundledCli(pluginRoot);
  if (bundled) return bundled;

  const onPath = findOnPath("pushtodisplay", env);
  if (onPath) {
    return { exe: onPath, prefix: [], source: "path", display: onPath };
  }

  return {
    exe: "npx",
    prefix: ["--yes", "pushtodisplay"],
    source: "npx",
    display: "npx --yes pushtodisplay",
  };
}

/**
 * @typedef {object} RunOpts
 * @property {number} [timeoutMs]
 * @property {NodeJS.ProcessEnv} [env]
 * @property {string} [pluginRoot]
 * @property {number} [maxBuffer]
 */

/**
 * @param {string[]} args
 * @param {RunOpts} [opts]
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
export function runCli(args, opts = {}) {
  const command = resolveCli(opts);
  const env = opts.env ?? process.env;
  return new Promise((resolve, reject) => {
    execFile(
      command.exe,
      [...command.prefix, ...args],
      {
        timeout: opts.timeoutMs ?? 15_000,
        encoding: "utf8",
        env,
        maxBuffer: opts.maxBuffer ?? 4 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          const err = /** @type {NodeJS.ErrnoException & { stdout?: string, stderr?: string }} */ (
            error
          );
          err.stdout = String(stdout ?? "");
          err.stderr = String(stderr ?? "");
          reject(err);
          return;
        }
        resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
      },
    );
  });
}

/**
 * Build the CLI argv for a board update payload.
 * @param {Payload} payload
 * @param {string} boardId
 * @returns {string[]}
 */
export function sendArgs(payload, boardId) {
  /** @type {string[]} */
  const args = ["send"];
  if (boardId) args.push("-b", boardId);
  args.push("-p", String(payload.panelId));
  if (payload.background) args.push("--background", payload.background);
  if (payload.density) args.push("--density", payload.density);
  for (const block of payload.blocks) args.push("--block", JSON.stringify(block));
  return args;
}

/**
 * Send a display update. Throws on failure (auth or network).
 * @param {Payload} payload
 * @param {string} boardId
 * @param {RunOpts} [opts]
 * @returns {Promise<void>}
 */
export async function sendPayload(payload, boardId, opts = {}) {
  await runCli(sendArgs(payload, boardId), { ...opts, timeoutMs: opts.timeoutMs ?? 12_000 });
}

/**
 * Probe auth state with `auth status --json`.
 *
 * The current CLI exits 0 for both states and reports `authenticated`
 * explicitly. Older builds printed human-readable text, so fall back to the
 * legacy heuristics when JSON parsing is not available.
 * @param {RunOpts} [opts]
 * @returns {Promise<boolean>}
 */
export async function authStatus(opts = {}) {
  try {
    const { stdout } = await runCli(["auth", "status", "--json"], {
      ...opts,
      timeoutMs: opts.timeoutMs ?? 10_000,
    });
    try {
      const parsed = JSON.parse(stdout);
      if (typeof parsed?.authenticated === "boolean") return parsed.authenticated;
    } catch {
      // Not JSON — likely an older CLI; fall through to text heuristics.
    }
    const denied = /Not authenticated/i.test(stdout) || /\(expired\)/i.test(stdout);
    const confirmed = /Auth method/i.test(stdout) && /All commands available/i.test(stdout);
    return confirmed && !denied;
  } catch {
    // A non-zero exit or a missing binary means "cannot send right now".
    return false;
  }
}

/**
 * Spawn the CLI for the OAuth device-code flow, streaming stdout/stderr.
 * @param {string[]} args
 * @param {{ env?: NodeJS.ProcessEnv, pluginRoot?: string, stdio?: "pipe" | "ignore" }} [opts]
 * @returns {import("node:child_process").ChildProcess}
 */
export function spawnCli(args, opts = {}) {
  const command = resolveCli(opts);
  const env = opts.env ?? process.env;
  const pipe = (opts.stdio ?? "pipe") === "pipe";
  return spawn(command.exe, [...command.prefix, ...args], {
    stdio: ["ignore", pipe ? "pipe" : "ignore", "pipe"],
    env,
  });
}

/**
 * True when the failure looks like an auth problem (401/403/unauthorized).
 * @param {unknown} error
 * @returns {boolean}
 */
export function isAuthFailure(error) {
  return /unauthor|401|403|forbidden/i.test(/** @type {Error} */ (error)?.message ?? "");
}

/**
 * True when the underlying executable could not be spawned at all (ENOENT).
 * @param {unknown} error
 * @returns {boolean}
 */
export function isCliMissing(error) {
  return /** @type {NodeJS.ErrnoException} */ (error)?.code === "ENOENT";
}

/**
 * Human-readable install hint.
 * @returns {string}
 */
export function cliNotFoundMessage() {
  return [
    "Push To Display CLI not found.",
    "Install it with: npm i -g pushtodisplay",
    "The plugin also falls back to: npx --yes pushtodisplay",
  ].join(" ");
}
