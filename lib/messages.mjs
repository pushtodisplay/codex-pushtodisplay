// @ts-check
/**
 * One message per event, and every message has exactly the same shape.
 *
 * A panel is a shared scrolling log: several agents may write to the same
 * panel, so each line identifies its speaker. A message is one wrapping
 * paragraph of inline runs, so the whole line is a single sentence:
 *
 *   codex running grep FAIL 11:04
 *   qa Allow bash: git push NEEDS 11:07
 *   release Pinned the clock so the release test passes. DONE 11:08
 *
 *   <agent> <what happened> <STATUS> <HH:MM>
 *
 * The agent name leads, so a shared panel reads as one column per agent. There
 * is no separator glyph: the fields are plain words at one size, and the upper
 * case status marks the end of the event.
 */
import { describeTool, tidyText } from "./describe.mjs";
import { truncate } from "./config.mjs";
import { ACCENT, STATUS_COLOR, SURFACE, TEXT, TEXT_DIM } from "./payloads.mjs";

/** @typedef {import("./payloads.mjs").Payload} Payload */
/** @typedef {import("./payloads.mjs").Status} Status */

/**
 * @param {string} wall
 * @returns {string}
 */
const hhmm = (wall) => wall.slice(0, 5);

/**
 * @param {string} text
 * @returns {string}
 */
const oneLine = (text) => text.replace(/\s+/g, " ").trim();

/**
 * Collapse whitespace, then fall back — never let a field render as blank.
 * @param {string} text
 * @param {string} fallback
 * @returns {string}
 */
const say = (text, fallback) => oneLine(text ?? "") || fallback;

/**
 * @param {object} opts
 * @param {number} opts.panelId
 * @param {string} opts.agent
 * @param {string} opts.wall
 * @param {string} opts.body
 * @param {Status} opts.status
 * @returns {Payload}
 */
function line(opts) {
  /**
   * @param {string} text
   * @param {string} color
   */
  const run = (text, color) => ({ text, color });
  return {
    panelId: opts.panelId,
    density: "compact",
    background: SURFACE,
    blocks: [
      run(opts.agent, ACCENT),
      run(` ${oneLine(opts.body)}`, TEXT),
      run(` ${opts.status.toUpperCase()}`, STATUS_COLOR[opts.status]),
      run(` ${hhmm(opts.wall)}`, TEXT_DIM),
    ],
  };
}

/**
 * @param {{ panelId: number, agent: string, wall: string }} opts
 * @returns {Payload}
 */
export function sessionOpenedMessage(opts) {
  return line({ ...opts, body: "session opened", status: "ready" });
}

/**
 * @param {{ panelId: number, agent: string, wall: string }} opts
 * @returns {Payload}
 */
export function sessionClosedMessage(opts) {
  return line({ ...opts, body: "session closed", status: "ended" });
}

/**
 * @param {{ panelId: number, agent: string, wall: string }} opts
 * @returns {Payload}
 */
export function renamedMessage(opts) {
  return line({ ...opts, body: "session renamed", status: "ready" });
}

/**
 * A run starts: the prompt this agent was handed.
 * @param {{ panelId: number, agent: string, wall: string, task: string, cwd?: string }} opts
 * @returns {Payload}
 */
export function taskMessage(opts) {
  return line({
    panelId: opts.panelId,
    agent: opts.agent,
    wall: opts.wall,
    body: say(shortenProse(tidyText(opts.task, { cwd: opts.cwd })), "new task"),
    status: "run",
  });
}

/**
 * A tool step, posted when it finishes so every step line carries a true
 * outcome instead of claiming "running" forever after it is over.
 * @param {object} opts
 * @param {number} opts.panelId
 * @param {string} opts.agent
 * @param {string} opts.wall
 * @param {string} opts.toolName
 * @param {unknown} opts.args
 * @param {string} opts.cwd
 * @param {boolean} opts.ok
 * @returns {Payload}
 */
export function stepMessage(opts) {
  return line({
    panelId: opts.panelId,
    agent: opts.agent,
    wall: opts.wall,
    body: describeTool(opts.toolName, opts.args, { cwd: opts.cwd }),
    status: opts.ok ? "ok" : "fail",
  });
}

/**
 * Longest prose body — the prompt and the result, the only two bodies we did
 * not write ourselves. 60 characters is under two rows at the board's default
 * type size: enough for the ask or the answer to be recognisable, short enough
 * that a pasted paragraph does not push the rest of the log off the panel.
 */
const PROSE_MAX = 60;

/**
 * Cut free text to something a person can read on a board. The first sentence
 * carries the ask/answer and the rest is detail, so the first sentence of
 * usable length wins; only if that is still too long do we fall back to a
 * word-boundary cut.
 * @param {string} text
 * @returns {string}
 */
export function shortenProse(text) {
  const clean = oneLine(text);
  if (!clean) return "";
  const sentences = clean.split(/(?<=[.!?])\s+/);
  const lead = sentences.find((sentence) => sentence.length >= 12) ?? sentences[0] ?? clean;
  return truncate(lead, PROSE_MAX);
}

/**
 * The run finished on its own: say what it produced.
 * @param {{ panelId: number, agent: string, wall: string, text: string }} opts
 * @returns {Payload}
 */
export function doneMessage(opts) {
  return line({
    panelId: opts.panelId,
    agent: opts.agent,
    wall: opts.wall,
    body: say(shortenProse(opts.text), "no summary"),
    status: "done",
  });
}

/**
 * @type {Record<string, string>}
 */
const WANTS = {
  confirm: "waiting for your approval",
  select: "waiting for you to choose",
  input: "waiting for you to type something",
  editor: "waiting for you to edit something",
  custom: "waiting for your input",
};

/**
 * A prompt is blocking the run: the one status a human must act on.
 * @param {{ panelId: number, agent: string, wall: string, kind: string, title?: string }} opts
 * @returns {Payload}
 */
export function blockedMessage(opts) {
  return line({
    panelId: opts.panelId,
    agent: opts.agent,
    wall: opts.wall,
    body: say(opts.title ?? "", WANTS[opts.kind] ?? "waiting for your input"),
    status: "needs",
  });
}

/**
 * You pressed Escape. Distinct from FAIL: nothing went wrong.
 * @param {{ panelId: number, agent: string, wall: string }} opts
 * @returns {Payload}
 */
export function stoppedMessage(opts) {
  return line({ ...opts, body: "interrupted before it finished", status: "stop" });
}

/**
 * The model or the provider failed.
 * @param {{ panelId: number, agent: string, wall: string, detail: string }} opts
 * @returns {Payload}
 */
export function errorMessage(opts) {
  return line({
    panelId: opts.panelId,
    agent: opts.agent,
    wall: opts.wall,
    body: say(opts.detail, "the model call failed"),
    status: "fail",
  });
}

/**
 * Wiring check for the CLI's `test` command.
 * @param {{ panelId: number, agent: string, wall: string }} opts
 * @returns {Payload}
 */
export function testMessage(opts) {
  return line({
    ...opts,
    body: `link OK, panel ${opts.panelId}`,
    status: "ok",
  });
}

/**
 * Written by the CLI's `clear` command.
 * @param {{ panelId: number, agent: string, wall: string }} opts
 * @returns {Payload}
 */
export function clearedMessage(opts) {
  return line({ ...opts, body: "log cleared", status: "ok" });
}
