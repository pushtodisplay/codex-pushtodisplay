// @ts-check
/**
 * Wire types for the Push To Display API, plus the palette.
 *
 * A board message is one wrapping paragraph: `blocks` are inline runs (like
 * `<span>`), not lines (like `<p>`). Separate lines are separate messages,
 * which the panel renders as a scrolling history.
 */

/**
 * One inline run. Only `text` and `color` are ever set: size and weight are
 * left to the renderer's defaults so every line is the same weight.
 * @typedef {object} Block
 * @property {string} text
 * @property {string} [color]
 */

/**
 * @typedef {"compact" | "standard" | "spacious"} Density
 */

/**
 * @typedef {object} Payload
 * @property {number} panelId
 * @property {string} [background]
 * @property {Density} [density]
 * @property {Block[]} blocks
 */

/**
 * The status vocabulary is closed. A line can never invent its own state.
 * @typedef {"ready" | "run" | "ok" | "fail" | "needs" | "done" | "stop" | "ended"} Status
 */

/** A near-black card carries its own contrast on light and dark boards. */
export const SURFACE = "#1b2430";

/** Body text. */
export const TEXT = "#f2f6f9";

/** Agent name — the one colour that repeats down the left edge. */
export const ACCENT = "#5ec8d4";

/** Time. Dimmest thing on the line, but still above 4.5:1 on the surface. */
export const TEXT_DIM = "#808c99";

/**
 * Status words, coloured by category rather than identity: blue means the
 * agent is up, green a step or run worked, amber it wants you, red something
 * failed, grey nothing is happening.
 * @type {Record<Status, string>}
 */
export const STATUS_COLOR = {
  ready: "#8ab4f8",
  run: "#8ab4f8",
  ok: "#4ade80",
  done: "#4ade80",
  fail: "#ff7b72",
  needs: "#f5b942",
  stop: "#9aa4b0",
  ended: "#9aa4b0",
};
