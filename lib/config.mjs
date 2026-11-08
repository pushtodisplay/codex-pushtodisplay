// @ts-check
/**
 * Configuration for codex-pushtodisplay.
 *
 * Everything comes from environment variables so a Codex process (or a whole
 * machine) can be aimed at a different panel without per-session files:
 *
 *   PUSHTODISPLAY_BOARD_ID   Send to a specific board (default: the default board)
 *   PUSHTODISPLAY_PANEL      (1-4) which panel this agent writes to (default 1)
 *   PUSHTODISPLAY_LABEL      agent name shown on every line (default: cwd basename)
 *   PUSHTODISPLAY_STEPS      Set to "0" to post milestones only
 *   PUSHTODISPLAY_DISABLED   Set to "1" to disable the plugin entirely
 *
 * Internal/test overrides:
 *   PUSHTODISPLAY_CACHE_DIR  Where session state lives
 *   PUSHTODISPLAY_CLI        Absolute path to a pushtodisplay executable
 *   PUSHTODISPLAY_SEND_INTERVAL_MS  Minimum gap between sends (default 1200)
 */

export const MAX_PANEL = 4;
export const MIN_PANEL = 1;
export const DEFAULT_INTERVAL_MS = 1200;

/**
 * @typedef {object} Config
 * @property {string} boardId Board ID to send to; empty string means the default board.
 * @property {number} panel Which panel (1-4) this agent writes to.
 * @property {string} label Explicit agent label, or empty to fall back to the cwd basename.
 * @property {boolean} disabled When true the plugin does nothing.
 * @property {boolean} steps When true every finished tool call is posted.
 * @property {number} intervalMs Minimum spacing between sends.
 */

/**
 * Parse an integer between MIN_PANEL and MAX_PANEL, falling back to `dflt`.
 * @param {string | undefined} value
 * @param {number} dflt
 * @returns {number}
 */
export function num(value, dflt) {
  const n = Number(value);
  return Number.isInteger(n) && n >= MIN_PANEL && n <= MAX_PANEL ? n : dflt;
}

/**
 * Normalize whitespace and enforce a max length, appending an ellipsis.
 * @param {string} value
 * @param {number} max
 * @returns {string}
 */
export function truncate(value, max) {
  const clean = String(value ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  // Prefer a word boundary; fall back to a hard cut for a single long token
  // (a path, a hash) where cutting mid-token is the least bad option.
  const body = space > max * 0.6 ? cut.slice(0, space) : cut;
  return body.trimEnd() + "…";
}

/**
 * Current wall-clock time as HH:MM:SS.
 * @returns {string}
 */
export function clock() {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

/**
 * Read the config from an environment object. Pure and testable.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Config}
 */
export function loadConfig(env = process.env) {
  const interval = Number(env.PUSHTODISPLAY_SEND_INTERVAL_MS);
  return {
    boardId: env.PUSHTODISPLAY_BOARD_ID ?? "",
    panel: num(env.PUSHTODISPLAY_PANEL, 1),
    label: env.PUSHTODISPLAY_LABEL ?? "",
    disabled: env.PUSHTODISPLAY_DISABLED === "1",
    steps: env.PUSHTODISPLAY_STEPS !== "0",
    intervalMs:
      Number.isFinite(interval) && interval >= 0 ? interval : DEFAULT_INTERVAL_MS,
  };
}

/**
 * The agent name for the first field of every line. Explicit label first,
 * then the session cwd's basename, then a stable fallback.
 * @param {Config} config
 * @param {string} cwd
 * @returns {string}
 */
export function agentLabel(config, cwd) {
  const explicit = config.label.trim();
  if (explicit) return explicit;
  const base = String(cwd ?? "")
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .filter(Boolean)
    .pop();
  return base || "codex";
}

/**
 * Absolute path to the per-user cache root used for session state.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string}
 */
export function cacheDir(env = process.env) {
  if (env.PUSHTODISPLAY_CACHE_DIR) return env.PUSHTODISPLAY_CACHE_DIR;
  const xdg = env.XDG_CACHE_HOME;
  if (xdg) return `${xdg.replace(/[\\/]+$/, "")}/pushtodisplay/codex`;
  return `${env.HOME ?? ""}/.cache/pushtodisplay/codex`;
}
