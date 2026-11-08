// @ts-check
/**
 * Map one Codex hook event to at most one board line, mutating the small
 * amount of session state the line needs.
 *
 * The mapping is deliberately silent about machinery: a turn boundary, a
 * compaction, a subagent's inner tool loop, and a successful model attempt are
 * facts about the harness, not news. What a person at the board needs is the
 * session opening/closing, what was asked, what finished, what needs approval,
 * how the run ended, and what failed.
 */
import { clock, agentLabel } from "./config.mjs";
import { describePermission, isToolFailure } from "./describe.mjs";
import {
  blockedMessage,
  doneMessage,
  errorMessage,
  sessionClosedMessage,
  sessionOpenedMessage,
  stepMessage,
  stoppedMessage,
  taskMessage,
} from "./messages.mjs";

/** @typedef {import("./config.mjs").Config} Config */
/** @typedef {import("./session-state.mjs").SessionState} SessionState */
/** @typedef {import("./payloads.mjs").Payload} Payload */

/**
 * @typedef {object} HookEvent
 * @property {string} hook_event_name
 * @property {string} [session_id]
 * @property {string} [cwd]
 * @property {string} [source]
 * @property {string} [reason]
 * @property {string} [prompt]
 * @property {string} [tool_name]
 * @property {unknown} [tool_input]
 * @property {unknown} [tool_response]
 * @property {string} [agent_id]
 * @property {string} [agent_type]
 * @property {string | null} [last_assistant_message]
 * @property {boolean} [stop_hook_active]
 * @property {string} [status]
 * @property {string | null} [error]
 */

/**
 * @typedef {object} EventResult
 * @property {Payload | null} payload
 * @property {boolean} urgent
 * @property {boolean} final
 * @property {boolean} removeState
 * @property {boolean} forceAuth
 */

/**
 * @param {HookEvent} event
 * @param {Config} config
 * @param {SessionState} state
 * @returns {EventResult}
 */
export function handleEvent(event, config, state) {
  /** @type {EventResult} */
  const result = {
    payload: null,
    urgent: false,
    final: false,
    removeState: false,
    forceAuth: false,
  };

  if (typeof event.cwd === "string" && event.cwd) state.cwd = event.cwd;
  state.label = agentLabel(config, state.cwd);
  const panelId = config.panel;
  const agent = state.label;

  switch (event.hook_event_name) {
    case "SessionStart": {
      // Compaction fires SessionStart too. It is housekeeping, not a new
      // session, so it must not add another READY line to the trail.
      if (event.source === "compact") return result;
      state.task = "";
      state.lastAssistant = "";
      result.payload = sessionOpenedMessage({ panelId, agent, wall: clock() });
      result.urgent = true;
      result.forceAuth = true;
      return result;
    }

    case "UserPromptSubmit": {
      const prompt = typeof event.prompt === "string" ? event.prompt : "";
      state.task = prompt;
      state.lastAssistant = "";
      result.payload = taskMessage({
        panelId,
        agent,
        wall: clock(),
        task: state.task,
        cwd: state.cwd,
      });
      result.urgent = true;
      return result;
    }

    case "PostToolUse": {
      // Subagent tool loops use the parent session id and would otherwise turn
      // one main-thread line into a waterfall of inner steps.
      if (event.agent_id || event.agent_type) return result;
      if (!config.steps) return result;
      const toolName = event.tool_name || "tool";
      const ok = !isToolFailure(event.tool_response);
      result.payload = stepMessage({
        panelId,
        agent,
        wall: clock(),
        toolName,
        args: event.tool_input,
        cwd: state.cwd,
        ok,
      });
      // A failed step is news that should survive backlog trimming; a routine
      // step is the first thing to drop when the log falls behind.
      result.urgent = !ok;
      return result;
    }

    case "PermissionRequest": {
      // Log the question but return no decision (no stdout), so Codex's normal
      // approval prompt still decides. Do not let a logging hook answer for
      // the user.
      const title = describePermission(event.tool_name || "tool", event.tool_input, {
        cwd: state.cwd,
      });
      result.payload = blockedMessage({
        panelId,
        agent,
        wall: clock(),
        kind: "confirm",
        title,
      });
      result.urgent = true;
      return result;
    }

    case "Stop": {
      // Another Stop hook already continued this turn; posting DONE again
      // would duplicate the result the first stop already reported.
      if (event.stop_hook_active) return result;
      const text = event.last_assistant_message ?? "";
      state.lastAssistant = text;
      result.payload = doneMessage({ panelId, agent, wall: clock(), text });
      result.urgent = true;
      result.final = true;
      return result;
    }

    case "Interrupt": {
      result.payload = stoppedMessage({ panelId, agent, wall: clock() });
      result.urgent = true;
      result.final = true;
      return result;
    }

    case "SessionEnd": {
      result.payload = sessionClosedMessage({ panelId, agent, wall: clock() });
      result.urgent = true;
      result.final = true;
      result.removeState = true;
      return result;
    }

    case "PostModelRequest": {
      // A failed attempt on a subagent is the parent's noise, not the board's.
      if (event.agent_id || event.agent_type) return result;
      if (event.status !== "failed") return result;
      result.payload = errorMessage({
        panelId,
        agent,
        wall: clock(),
        detail: event.error || "the model call failed",
      });
      result.urgent = true;
      return result;
    }

    default:
      return result;
  }
}

/**
 * The final-event deadline in milliseconds. Codex gives Interrupt and
 * SessionEnd at most three seconds; Stop is allowed longer, but a result line
 * should not hold the user's prompt hostage.
 * @param {string} hookEventName
 * @returns {number}
 */
export function finalDeadlineMs(hookEventName) {
  switch (hookEventName) {
    case "Interrupt":
    case "SessionEnd":
      return 2400;
    case "Stop":
      return 5000;
    default:
      return 0;
  }
}
