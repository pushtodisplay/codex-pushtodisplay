// @ts-check
/**
 * Per-Codex-install setup state.
 *
 * A valid `pushtodisplay` credential is shared by every integration on the
 * machine (Codex, opencode, pi, ...). Credential presence therefore must not be
 * treated as "this integration is set up". This marker is written only after
 * the Codex setup flow has verified auth and sent a test entry.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { stateDir } from "./session-state.mjs";

export const SETUP_VERSION = 1;

/**
 * @typedef {object} SetupRecord
 * @property {number} version
 * @property {number} completedAt
 * @property {string} boardId
 * @property {number} panel
 * @property {string} label
 * @property {string} cliVersion
 */

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function setupPath(env = process.env) {
  return path.join(stateDir(env), "setup.json");
}

/**
 * Read the validated setup marker, or null when setup has not completed.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {SetupRecord | null}
 */
export function loadSetupRecord(env = process.env) {
  try {
    const parsed = JSON.parse(fs.readFileSync(setupPath(env), "utf8"));
    if (
      !parsed ||
      typeof parsed !== "object" ||
      parsed.version !== SETUP_VERSION ||
      !(Number(parsed.completedAt) > 0)
    ) {
      return null;
    }
    return {
      version: SETUP_VERSION,
      completedAt: Number(parsed.completedAt),
      boardId: String(parsed.boardId ?? ""),
      panel: Number(parsed.panel) || 1,
      label: String(parsed.label ?? ""),
      cliVersion: String(parsed.cliVersion ?? ""),
    };
  } catch {
    return null;
  }
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean}
 */
export function isSetupComplete(env = process.env) {
  return loadSetupRecord(env) !== null;
}

/**
 * @typedef {object} SetupDetails
 * @property {string} [boardId]
 * @property {number} [panel]
 * @property {string} [label]
 * @property {string} [cliVersion]
 */

/**
 * Record a completed setup for this Codex plugin. Atomic write; the marker is
 * deliberately per-user/per-Codex cache, not per-session.
 * @param {SetupDetails} [details]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {SetupRecord}
 */
export function markSetupComplete(details = {}, env = process.env) {
  const dir = stateDir(env);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const target = setupPath(env);
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  const record = {
    version: SETUP_VERSION,
    completedAt: Date.now(),
    boardId: details.boardId ?? "",
    panel: details.panel ?? 1,
    label: details.label ?? "",
    cliVersion: details.cliVersion ?? "",
  };
  fs.writeFileSync(temp, JSON.stringify(record), { mode: 0o600 });
  fs.renameSync(temp, target);
  return record;
}
