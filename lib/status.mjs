// @ts-check
/**
 * Human and JSON status for the operator helper.
 *
 * The helper is frequently run from a model shell, which Codex sandboxes. In
 * that environment the CLI cannot read the host credential store or reach the
 * identity host, so "the probe failed" is not "the user is logged out". Keep
 * the setup marker and the auth check separate, and report auth as three
 * states:
 *
 *   authenticated    -> a positive answer from the CLI
 *   unauthenticated  -> a positive "logged out" answer from the CLI
 *   unavailable      -> the probe itself could not run here
 *
 * Only `unauthenticated` is presented as a login failure.
 */
import { agentLabel } from "./config.mjs";

/** @typedef {import("./cli-adapter.mjs").AuthCheck} AuthCheck */
/** @typedef {import("./cli-adapter.mjs").AuthCheckState} AuthCheckState */
/** @typedef {import("./config.mjs").Config} Config */
/** @typedef {import("./setup-state.mjs").SetupRecord} SetupRecord */

/**
 * @typedef {object} StatusData
 * @property {string} cli
 * @property {{ state: AuthCheckState, reason: string | null }} auth
 * @property {boolean | null} authenticated True/false only for a real answer; null when unchecked.
 * @property {boolean} authChecked False when the probe could not run here.
 * @property {boolean} setup
 * @property {string} setupFile
 * @property {number | null} setupCompletedAt
 * @property {string | null} boardId
 * @property {number} panel
 * @property {string} label
 * @property {boolean} steps
 * @property {boolean} disabled
 * @property {string} cacheDir
 */

/**
 * @param {object} input
 * @param {Config} input.config
 * @param {string} input.cwd
 * @param {string} input.cli
 * @param {AuthCheck} input.auth
 * @param {SetupRecord | null} input.setupRecord
 * @param {string} input.setupFile
 * @param {string} input.cacheDir
 * @returns {StatusData}
 */
export function buildStatus(input) {
  return {
    cli: input.cli,
    auth: { state: input.auth.state, reason: input.auth.reason ?? null },
    authenticated:
      input.auth.state === "unavailable" ? null : input.auth.state === "authenticated",
    authChecked: input.auth.state !== "unavailable",
    setup: Boolean(input.setupRecord),
    setupFile: input.setupFile,
    setupCompletedAt: input.setupRecord?.completedAt ?? null,
    boardId: input.config.boardId || null,
    panel: input.config.panel,
    label: agentLabel(input.config, input.cwd),
    steps: input.config.steps,
    disabled: input.config.disabled,
    cacheDir: input.cacheDir,
  };
}

/**
 * @param {StatusData} data
 * @returns {string}
 */
export function authLine(data) {
  switch (data.auth.state) {
    case "authenticated":
      return "Auth:     logged in";
    case "unauthenticated":
      return "Auth:     not logged in — run: $pushtodisplay:setup from a normal terminal";
    case "unavailable":
      return "Auth:     not checked here (sandbox/network/keychain); this does not mean logged out";
  }
}

/**
 * @param {StatusData} data
 * @returns {string}
 */
export function setupLine(data) {
  return data.setup
    ? "Setup:    complete"
    : "Setup:    not complete — run: $pushtodisplay:setup from a normal terminal";
}

/**
 * @param {StatusData} data
 * @returns {string}
 */
export function formatStatus(data) {
  return [
    "Push To Display — codex-pushtodisplay",
    `Board:    ${data.boardId || "default board"}`,
    `Panel:    ${data.panel}`,
    `Label:    ${data.label}`,
    setupLine(data),
    authLine(data),
  ].join("\n") + "\n";
}
