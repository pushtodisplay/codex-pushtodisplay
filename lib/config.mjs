/**
 * Configuration for codex-pushtodisplay.
 *
 * All settings come from environment variables so each Codex session can write
 * to a different panel without a per-session config file:
 *
 *   PUSHTODISPLAY_BOARD_ID    Send to a specific board (default: your default board)
 *   PUSHTODISPLAY_PANEL       (1-4) which panel this agent writes to (default 1)
 *   PUSHTODISPLAY_LABEL       agent name shown on its panel (default: cwd basename)
 *   PUSHTODISPLAY_DISABLED    Set to "1" to disable the plugin entirely
 *   PUSHTODISPLAY_STEPS       Set to "0" to post milestones only, not each tool call
 *   PUSHTODISPLAY_CLI         Optional path to the pushtodisplay executable
 *   PUSHTODISPLAY_CACHE_DIR   Override the cache directory (tests and unusual setups)
 */
import * as os from "node:os";
import * as path from "node:path";

export const MAX_PANEL = 4;
export const MIN_PANEL = 1;

/** Keep sends comfortably above the Sandbox tier's ~1 msg/s cap. */
export const MIN_INTERVAL_MS = 1200;

/** Queued entries before the oldest steps are dropped (~30 s of lag). */
export const MAX_PENDING = 25;

/** Re-probe a known-bad auth state at most this often. */
export const AUTH_PROBE_INTERVAL_MS = 20_000;

/**
 * @typedef {object} Config
 * @property {string} boardId Board ID; empty means "use the default board".
 * @property {number} panel Panel 1-4.
 * @property {string} label Friendly agent name; empty means "derive from cwd".
 * @property {boolean} disabled When true the plugin does nothing.
 * @property {boolean} steps When true tool calls and subagents are posted.
 * @property {number} minIntervalMs Spacing between sends.
 */

/** Parse an integer between MIN_PANEL and MAX_PANEL, falling back to `dflt`. */
export function num(v, dflt) {
  const n = Number(v);
  return Number.isInteger(n) && n >= MIN_PANEL && n <= MAX_PANEL ? n : dflt;
}

/** Normalize whitespace and enforce a max length, appending an ellipsis. */
export function truncate(s, n) {
  const clean = String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= n) return clean;
  const cut = clean.slice(0, Math.max(0, n - 1));
  const space = cut.lastIndexOf(" ");
  // Prefer a word boundary; fall back to a hard cut for single long tokens
  // (a path, a hash) where cutting mid-token is the least bad option.
  const body = space > n * 0.6 ? cut.slice(0, space) : cut;
  return body.trimEnd() + "…";
}

/** Current wall-clock time as HH:MM:SS. */
export function clock(date = new Date()) {
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((x) => String(x).padStart(2, "0"))
    .join(":");
}

/** HH:MM — a full timestamp is noise in a trail. */
export function hhmm(wall) {
  return wall.slice(0, 5);
}

/** Read the plugin config from the environment. Pure and testable. */
export function loadConfig(env = process.env) {
  const interval = Number(env.PUSHTODISPLAY_MIN_INTERVAL_MS);
  return {
    boardId: env.PUSHTODISPLAY_BOARD_ID ?? "",
    panel: num(env.PUSHTODISPLAY_PANEL, 1),
    label: env.PUSHTODISPLAY_LABEL ?? "",
    disabled: env.PUSHTODISPLAY_DISABLED === "1",
    steps: env.PUSHTODISPLAY_STEPS !== "0",
    minIntervalMs:
      Number.isFinite(interval) && interval >= 0 ? interval : MIN_INTERVAL_MS,
  };
}

/** The agent name shown in the first field of every line. */
export function labelFor(env, cwd) {
  const explicit = String(env.PUSHTODISPLAY_LABEL ?? "").trim();
  if (explicit) return explicit;
  const base = path.basename(cwd || process.cwd());
  return base || "codex";
}

/**
 * Per-user cache directory for session state, auth state, locks, and logs.
 *
 * Deliberately under `~/.cache` rather than the plugin root: the plugin root
 * changes on every update and must never hold mutable state.
 */
export function cacheDir(env = process.env) {
  const override = String(env.PUSHTODISPLAY_CACHE_DIR ?? "").trim();
  if (override) return path.resolve(override);
  const home = env.HOME || env.USERPROFILE || os.homedir();
  return path.join(home, ".cache", "pushtodisplay", "codex");
}
