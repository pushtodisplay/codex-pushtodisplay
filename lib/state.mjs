/**
 * On-disk session state, auth state, and cross-process locks.
 *
 * Every hook invocation is a separate Node process, so the queue, the rate
 * limit clock, and the auth decision must live on disk. All reads/writes go
 * through short-lived lock files; sends are serialized by a separate drain
 * lock so only one process talks to the API at a time.
 */
import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import * as path from "node:path";

import { cacheDir } from "./config.mjs";
import { createState } from "./panel-state.mjs";

/**
 * @typedef {import("./panel-state.mjs").PanelState} PanelState
 * @typedef {{status: "ok"|"bad", at: number}} AuthCache
 */

/** Sanitize a session id for use as a file name. */
export function safeSessionId(sessionId) {
  return (
    String(sessionId || "unknown")
      .replace(/[^A-Za-z0-9._-]/g, "_")
      .slice(0, 200) || "unknown"
  );
}

/** Absolute path of a session's state file. */
export function stateFile(sessionId, env = process.env) {
  return path.join(cacheDir(env), `${safeSessionId(sessionId)}.json`);
}

/** Absolute path of the account-level auth cache. */
export function authFile(env = process.env) {
  return path.join(cacheDir(env), "auth.json");
}

/** Absolute path of the device-code login log. */
export function loginLog(env = process.env) {
  return path.join(cacheDir(env), "login.log");
}

/** Lock file guarding a session state file. */
export function stateLockFile(statePath) {
  return `${statePath}.lock`;
}

/** Lock file guarding the send drain for a session. */
export function drainLockFile(statePath) {
  return `${statePath}.drain.lock`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Ensure a private directory exists. */
export async function ensureDir(dir) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
}

/**
 * Read a JSON file, returning null when it is missing or unreadable.
 *
 * @param {string} file
 * @returns {Promise<unknown|null>}
 */
export async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

/** Write JSON atomically (temp file + rename) so readers never see half a file. */
export async function writeJsonAtomic(file, value) {
  await ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(tmp, file);
}

/**
 * Acquire a lock file. Returns a release function.
 *
 * A lock older than `staleMs` is treated as abandoned (the process crashed
 * before removing it) and removed.
 *
 * @param {string} lockPath
 * @param {{timeoutMs?: number, staleMs?: number}} [opts]
 * @returns {Promise<() => Promise<void>>}
 */
export async function acquireLock(lockPath, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 3000;
  const staleMs = opts.staleMs ?? 60_000;
  const started = Date.now();
  await ensureDir(path.dirname(lockPath));

  for (;;) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, at: Date.now() }),
        "utf8",
      );
      await handle.close();
      return async () => {
        await rm(lockPath, { force: true });
      };
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code !== "EEXIST") throw err;
      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > staleMs) {
          await rm(lockPath, { force: true });
          continue;
        }
      } catch {
        // The lock vanished between open and stat; retry immediately.
        continue;
      }
      if (Date.now() - started >= timeoutMs) {
        throw new Error(`timed out waiting for lock ${lockPath}`);
      }
      await sleep(10 + Math.floor(Math.random() * 20));
    }
  }
}

/**
 * Run `fn` while holding a lock.
 *
 * @template T
 * @param {string} lockPath
 * @param {() => Promise<T>} fn
 * @param {{timeoutMs?: number, staleMs?: number}} [opts]
 * @returns {Promise<T>}
 */
export async function withLock(lockPath, fn, opts = {}) {
  const release = await acquireLock(lockPath, opts);
  try {
    return await fn();
  } finally {
    await release();
  }
}

/** Run `fn` while holding a session's state lock. */
export async function withStateLock(statePath, fn, opts = {}) {
  return withLock(stateLockFile(statePath), fn, {
    timeoutMs: opts.timeoutMs ?? 3000,
    staleMs: opts.staleMs ?? 15_000,
  });
}

/**
 * Coerce a parsed state file into the current shape, dropping unknown fields
 * and filling defaults. A corrupt file starts fresh rather than crashing a hook.
 *
 * @param {unknown} raw
 * @param {{sessionId?: string, agent?: string, cwd?: string}} defaults
 * @returns {PanelState}
 */
function normalizeState(raw, defaults) {
  const base = createState(defaults);
  if (!raw || typeof raw !== "object") return base;
  const r = /** @type {Record<string, unknown>} */ (raw);
  const queue = Array.isArray(r.queue)
    ? r.queue
        .filter((entry) => entry && typeof entry === "object")
        .map((entry) => {
          const e = /** @type {Record<string, unknown>} */ (entry);
          return {
            payload: e.payload,
            urgent: Boolean(e.urgent),
            createdAt: typeof e.createdAt === "number" ? e.createdAt : 0,
          };
        })
        .filter((entry) => entry.payload && typeof entry.payload === "object")
    : [];
  return {
    version: typeof r.version === "number" ? r.version : base.version,
    sessionId: typeof r.sessionId === "string" ? r.sessionId : base.sessionId,
    agent: typeof r.agent === "string" && r.agent ? r.agent : base.agent,
    cwd: typeof r.cwd === "string" && r.cwd ? r.cwd : base.cwd,
    task: typeof r.task === "string" ? r.task : "",
    lastAssistantText:
      typeof r.lastAssistantText === "string" ? r.lastAssistantText : "",
    queue: /** @type {PanelState["queue"]} */ (queue),
    lastKey: typeof r.lastKey === "string" ? r.lastKey : "",
    lastSentAt: typeof r.lastSentAt === "number" ? r.lastSentAt : 0,
    updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : Date.now(),
    lastError: typeof r.lastError === "string" ? r.lastError : "",
  };
}

/**
 * Load a session's state. Missing/corrupt files produce a fresh state.
 *
 * @param {string} sessionId
 * @param {{sessionId?: string, agent?: string, cwd?: string}} defaults
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<PanelState>}
 */
export async function loadState(sessionId, defaults, env = process.env) {
  const file = stateFile(sessionId, env);
  const raw = await readJson(file);
  return normalizeState(raw, { ...defaults, sessionId });
}

/** Persist a session's state. */
export async function saveState(state, env = process.env) {
  await writeJsonAtomic(stateFile(state.sessionId, env), state);
}

/** Load the account-level auth cache. */
export async function readAuth(env = process.env) {
  const raw = await readJson(authFile(env));
  if (!raw || typeof raw !== "object") return null;
  const r = /** @type {Record<string, unknown>} */ (raw);
  if (r.status !== "ok" && r.status !== "bad") return null;
  return {
    status: /** @type {"ok"|"bad"} */ (r.status),
    at: typeof r.at === "number" ? r.at : 0,
  };
}

/** Persist the account-level auth cache. */
export async function writeAuth(auth, env = process.env) {
  await writeJsonAtomic(authFile(env), auth);
}
