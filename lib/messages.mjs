/**
 * One message per event, and every message has exactly the same shape.
 *
 * A panel is a **shared** scrolling log: several agents may write to the same
 * panel, so each line identifies its speaker. A message is one wrapping
 * paragraph of inline runs (blocks behave like `<span>`), so the whole line is
 * a single sentence:
 *
 *   codex running grep RUN 11:04
 *   qa Allow Bash: git push NEEDS 11:07
 *   codex Pinned the clock so the release test passes. DONE 11:08
 *
 * One entry per event, written as one sentence. Bodies are shortened by
 * structure and then by a character budget (`describe.mjs` and `PROSE_MAX`),
 * preferring word boundaries, so the fields flow in a fixed order.
 *
 *   <agent> <what happened> <STATUS> <HH:MM>
 */
import { describePermission, describeTool, tidyText } from "./describe.mjs";
import { hhmm, truncate } from "./config.mjs";
import {
  ACCENT,
  STATUS_COLOR,
  SURFACE,
  TEXT,
  TEXT_DIM,
} from "./payloads.mjs";

/** Collapse whitespace so a multi-line provider error stays one line. */
const oneLine = (text) => String(text ?? "").replace(/\s+/g, " ").trim();

/** Collapse whitespace, then fall back — never let a field render as blank. */
const say = (text, fallback) => oneLine(text) || fallback;

/**
 * The only status words that may appear in a line.
 *
 * @typedef {"ready"|"run"|"ok"|"fail"|"needs"|"done"|"stop"|"ended"} Status
 */

/**
 * The one shape every message uses: four inline runs, one surface.
 *
 * @param {{panelId: number, agent: string, wall: string, body: string, status: Status}} opts
 * @returns {import("./payloads.mjs").Payload}
 */
function line(opts) {
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

/** The full visible line, used by tests and the fake CLI. */
export function payloadText(payload) {
  return payload.blocks.map((b) => b.text).join("");
}

/** The session opened (or resumed/forked). */
export function sessionOpenedMessage(opts) {
  return line({
    panelId: opts.panelId,
    agent: opts.agent,
    wall: opts.wall,
    body: "session opened",
    status: "ready",
  });
}

/** The session ended. */
export function sessionClosedMessage(opts) {
  return line({
    panelId: opts.panelId,
    agent: opts.agent,
    wall: opts.wall,
    body: "session closed",
    status: "ended",
  });
}

/** A run starts: the prompt this agent was handed. */
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
 * A tool call started. Posted from PreToolUse so the board shows forward
 * motion; the matching PostToolUse line carries the real outcome.
 */
export function toolStartedMessage(opts) {
  return line({
    panelId: opts.panelId,
    agent: opts.agent,
    wall: opts.wall,
    body: describeTool(opts.toolName, opts.args, { cwd: opts.cwd }),
    status: "run",
  });
}

/**
 * A tool call finished. PostToolUse fires for non-zero exits in Codex, so this
 * line always carries a true outcome.
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
 * Longest prose body — the prompt and the result, which are the only two bodies
 * we did not write ourselves.
 *
 * 60 characters is under two rows at `medium`. Enough for the ask or the
 * answer to be recognisable, short enough that a pasted paragraph does not push
 * the rest of the log off the panel.
 */
const PROSE_MAX = 60;

/**
 * Cut free text to something a person can read on a board.
 *
 * The first sentence carries the ask/answer and the rest is detail, so the first
 * sentence of usable length wins; only if that is still too long do we fall back
 * to a word-boundary cut. Used for both the prompt and the result.
 */
export function shortenProse(text) {
  const clean = oneLine(text);
  if (!clean) return "";
  const sentences = clean.split(/(?<=[.!?])\s+/);
  const lead = sentences.find((s) => s.length >= 12) ?? sentences[0] ?? clean;
  return truncate(lead, PROSE_MAX);
}

/** The run finished on its own: say what it produced. */
export function doneMessage(opts) {
  return line({
    panelId: opts.panelId,
    agent: opts.agent,
    wall: opts.wall,
    body: say(shortenProse(opts.text), "no summary"),
    status: "done",
  });
}

/** A permission prompt is blocking the run: the one status a human must act on. */
export function permissionMessage(opts) {
  return line({
    panelId: opts.panelId,
    agent: opts.agent,
    wall: opts.wall,
    body: say(
      describePermission(opts.toolName, opts.args, {
        cwd: opts.cwd,
        description: opts.description,
      }),
      "waiting for your permission",
    ),
    status: "needs",
  });
}

/** You pressed Escape. Distinct from FAIL: nothing went wrong. */
export function stoppedMessage(opts) {
  return line({
    panelId: opts.panelId,
    agent: opts.agent,
    wall: opts.wall,
    body: "interrupted before it finished",
    status: "stop",
  });
}

/** A model request failed (rate limit, provider error, context overflow). */
export function errorMessage(opts) {
  return line({
    panelId: opts.panelId,
    agent: opts.agent,
    wall: opts.wall,
    body: say(opts.detail, "the model call failed"),
    status: "fail",
  });
}

/** A subagent was spawned. Low-noise: one line, only when steps are on. */
export function subagentStartedMessage(opts) {
  return line({
    panelId: opts.panelId,
    agent: opts.agent,
    wall: opts.wall,
    body: opts.agentType
      ? `delegating to ${opts.agentType}`
      : "delegating to a subagent",
    status: "run",
  });
}

/** A subagent finished. Low-noise: one line, only when steps are on. */
export function subagentFinishedMessage(opts) {
  return line({
    panelId: opts.panelId,
    agent: opts.agent,
    wall: opts.wall,
    body: opts.agentType
      ? `subagent ${opts.agentType} finished`
      : "subagent finished",
    status: "ok",
  });
}

/** Wiring check for the test skill. */
export function testMessage(opts) {
  return line({
    panelId: opts.panelId,
    agent: opts.agent,
    wall: opts.wall,
    body: `link OK, panel ${opts.panelId}`,
    status: "ok",
  });
}

/** Written by the clear skill. */
export function clearedMessage(opts) {
  return line({
    panelId: opts.panelId,
    agent: opts.agent,
    wall: opts.wall,
    body: "log cleared",
    status: "ok",
  });
}
