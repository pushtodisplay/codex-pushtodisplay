/**
 * Per-session state.
 *
 * Each event becomes its own message (see `messages.mjs`), so this module
 * renders nothing. It holds the facts a message needs — what the agent was
 * asked, what it last said, the pending queue, and the rate-limit clock — and
 * lives on disk so every hook invocation sees the same session.
 */

export const STATE_VERSION = 1;

/** Keep a pasted wall of text from bloating the on-disk state file. */
const MAX_TEXT = 20_000;

/**
 * @typedef {import("./payloads.mjs").Payload} Payload
 */

/**
 * @typedef {object} QueueEntry
 * @property {Payload} payload
 * @property {boolean} urgent
 * @property {number} createdAt
 */

/**
 * @typedef {object} PanelState
 * @property {number} version
 * @property {string} sessionId
 * @property {string} agent
 * @property {string} cwd
 * @property {string} task
 * @property {string} lastAssistantText
 * @property {QueueEntry[]} queue
 * @property {string} lastKey
 * @property {number} lastSentAt
 * @property {number} updatedAt
 * @property {string} lastError
 */

/**
 * @param {{sessionId?: string, agent?: string, cwd?: string}} opts
 * @returns {PanelState}
 */
export function createState(opts = {}) {
  return {
    version: STATE_VERSION,
    sessionId: opts.sessionId ?? "",
    agent: opts.agent ?? "codex",
    cwd: opts.cwd ?? process.cwd(),
    task: "",
    lastAssistantText: "",
    queue: [],
    lastKey: "",
    lastSentAt: 0,
    updatedAt: Date.now(),
    lastError: "",
  };
}

/**
 * Reset for a fresh session. Keeps the queue so nothing queued is lost.
 * @param {PanelState} s
 * @param {{agent?: string, cwd?: string}} [opts]
 */
export function beginSession(s, opts = {}) {
  s.task = "";
  s.lastAssistantText = "";
  // A session start is news even if the same words were posted a minute ago.
  s.lastKey = "";
  if (opts.agent) s.agent = opts.agent;
  if (opts.cwd) s.cwd = opts.cwd;
  s.updatedAt = Date.now();
}

/** A new prompt arrived; an empty prompt keeps the existing task. */
export function beginTask(s, prompt) {
  // Kept raw: `messages.mjs` shortens paths, and trimming here would cut a path
  // before it could be shortened. The cap only stops a pasted novel from
  // bloating the state file; the visible body is capped at 60 anyway.
  if (prompt) s.task = String(prompt).slice(0, MAX_TEXT);
  s.lastAssistantText = "";
  s.updatedAt = Date.now();
}

/**
 * Keep what the agent actually said, so the result line can report it.
 *
 * Code fences are dropped — the board is not a terminal — and headings are
 * dropped because a heading is a label, not a result.
 */
export function cleanAssistantText(text) {
  return String(text ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .split("\n")
    .filter((line) => !/^\s{0,3}#{1,6}\s/.test(line))
    .join(" ")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Remember the last assistant text. An empty result clears the previous one,
 * so a turn that produced no closing text never quotes an earlier turn.
 */
export function noteAssistant(s, text) {
  s.lastAssistantText = cleanAssistantText(String(text ?? "").slice(0, MAX_TEXT));
  s.updatedAt = Date.now();
}
