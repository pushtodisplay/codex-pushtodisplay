// @ts-check
/** Shared test harness: a fake `pushtodisplay` executable and a hook runner. */
import { spawn } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { safeSessionId } from "../lib/session-state.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, "..");
export const hookPath = path.join(repoRoot, "hooks", "hook.mjs");

/**
 * @typedef {object} HarnessOpts
 * @property {boolean} [auth]
 * @property {number} [intervalMs]
 * @property {Record<string, string>} [env]
 */

/**
 * @typedef {object} RunResult
 * @property {number | null} code
 * @property {string | null} signal
 * @property {string} stdout
 * @property {string} stderr
 */

/**
 * @typedef {object} Harness
 * @property {string} root
 * @property {string} cache
 * @property {string} logPath
 * @property {Record<string, string>} env
 * @property {(event: unknown, overrides?: Record<string, string>) => Promise<RunResult>} run
 * @property {(raw: string, overrides?: Record<string, string>) => Promise<RunResult>} runRaw
 * @property {(events: unknown[], overrides?: Record<string, string>) => Promise<RunResult[]>} runAll
 * @property {() => SendEntry[]} entries
 * @property {(sessionId: string) => Record<string, unknown>} readState
 * @property {(sessionId: string) => boolean} stateExists
 * @property {() => void} cleanup
 */

/**
 * @typedef {object} SendEntry
 * @property {string[]} args
 * @property {number} at
 * @property {number | null} panel
 * @property {string | null} boardId
 * @property {string | null} background
 * @property {string | null} density
 * @property {{ text: string, color?: string }[]} blocks
 * @property {string} text
 */

const FAKE_CLI = `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
const authed = (process.env.FAKE_PTD_AUTH ?? "1") === "1";
if (args[0] === "auth" && args[1] === "status") {
  process.stdout.write(JSON.stringify({ authenticated: authed, method: authed ? "oauth" : null }) + "\\n");
  process.exit(0);
}
if (args[0] === "auth" && args[1] === "login") {
  process.stdout.write("Visit https://example.com/device and enter code ABCD-1234\\n");
  process.exit(Number(process.env.FAKE_PTD_LOGIN_EXIT ?? "0"));
}
if (args[0] === "send") {
  if (process.env.FAKE_PTD_FAIL_SEND === "1") {
    process.stderr.write("send failed");
    process.exit(1);
  }
  const log = process.env.FAKE_PTD_LOG;
  if (log) fs.appendFileSync(log, JSON.stringify({ args, at: Date.now() }) + "\\n");
  process.exit(0);
}
process.exit(0);
`;

/**
 * @param {HarnessOpts} [opts]
 * @returns {Harness}
 */
export function createHarness(opts = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "ptd-codex-"));
  const bin = path.join(root, "bin");
  const cache = path.join(root, "cache");
  const home = path.join(root, "home");
  const logPath = path.join(root, "sent.jsonl");
  const fake = path.join(bin, "pushtodisplay");

  mkdirSync(bin, { recursive: true });
  mkdirSync(home, { recursive: true });
  mkdirSync(cache, { recursive: true });
  writeFileSync(fake, FAKE_CLI);
  chmodSync(fake, 0o755);

  // Start from a small environment so a developer's own PUSHTODISPLAY_*
  // variables cannot change the test's expectations.
  const env = {
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
    HOME: home,
    PUSHTODISPLAY_CACHE_DIR: cache,
    PUSHTODISPLAY_SEND_INTERVAL_MS: String(opts.intervalMs ?? 0),
    FAKE_PTD_LOG: logPath,
    FAKE_PTD_AUTH: opts.auth === false ? "0" : "1",
    ...opts.env,
  };

  /**
   * @param {string} raw
   * @param {Record<string, string>} [overrides]
   * @returns {Promise<RunResult>}
   */
  function runRaw(raw, overrides = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [hookPath], {
        env: { ...env, ...overrides },
        stdio: ["pipe", "pipe", "pipe"],
      });
      /** @type {Buffer[]} */
      const out = [];
      /** @type {Buffer[]} */
      const err = [];
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`hook timed out after 15s: ${raw.slice(0, 200)}`));
      }, 15_000);
      child.stdout.on("data", (chunk) => out.push(Buffer.from(chunk)));
      child.stderr.on("data", (chunk) => err.push(Buffer.from(chunk)));
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        resolve({
          code,
          signal,
          stdout: Buffer.concat(out).toString("utf8"),
          stderr: Buffer.concat(err).toString("utf8"),
        });
      });
      child.stdin.end(raw);
    });
  }

  /**
   * @param {unknown} event
   * @param {Record<string, string>} [overrides]
   * @returns {Promise<RunResult>}
   */
  function run(event, overrides = {}) {
    return runRaw(JSON.stringify(event), overrides);
  }

  /** @returns {SendEntry[]} */
  function entries() {
    if (!existsSync(logPath)) return [];
    return readFileSync(logPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => parseSendEntry(JSON.parse(line)));
  }

  return {
    root,
    cache,
    logPath,
    env,
    run,
    runRaw,
    async runAll(events, overrides = {}) {
      /** @type {RunResult[]} */
      const results = [];
      for (const event of events) results.push(await run(event, overrides));
      return results;
    },
    entries,
    readState(sessionId) {
      const file = path.join(cache, `${safeSessionId(sessionId)}.json`);
      return JSON.parse(readFileSync(file, "utf8"));
    },
    stateExists(sessionId) {
      return existsSync(path.join(cache, `${safeSessionId(sessionId)}.json`));
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

/**
 * @param {{ args: string[], at: number }} record
 * @returns {SendEntry}
 */
function parseSendEntry(record) {
  const args = record.args;
  /** @type {{ text: string, color?: string }[]} */
  const blocks = [];
  let panel = null;
  let boardId = null;
  let background = null;
  let density = null;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--block") {
      const value = args[i + 1];
      if (value) blocks.push(JSON.parse(value));
    } else if (arg === "-p") {
      panel = Number(args[i + 1]);
    } else if (arg === "-b") {
      boardId = args[i + 1] ?? null;
    } else if (arg === "--background") {
      background = args[i + 1] ?? null;
    } else if (arg === "--density") {
      density = args[i + 1] ?? null;
    }
  }
  return {
    args,
    at: record.at,
    panel,
    boardId,
    background,
    density,
    blocks,
    text: blocks.map((block) => block.text).join(""),
  };
}

/**
 * Read a hook fixture.
 * @param {string} name
 * @returns {Record<string, unknown>}
 */
export function fixture(name) {
  return JSON.parse(
    readFileSync(path.join(repoRoot, "test", "fixtures", "hooks", `${name}.json`), "utf8"),
  );
}
