/**
 * Map one Codex hook event to zero or more board entries.
 *
 * This is the pure core: no filesystem, no network, no timers. `hooks/hook.mjs`
 * owns persistence and delivery; this module only decides what a person should
 * read on the board.
 *
 *   SessionStart        session opened                         READY
 *   SessionEnd          session closed                         ENDED
 *   UserPromptSubmit    <prompt>                               RUN
 *   PreToolUse          running npm test                       RUN
 *   PostToolUse         running npm test                       OK / FAIL
 *   PermissionRequest   Allow Bash: git push                   NEEDS
 *   Stop                <last assistant message>               DONE
 *   SubagentStart       delegating to Explore                  RUN
 *   SubagentStop        subagent Explore finished              OK
 *   Interrupt           interrupted before it finished         STOP
 *   PostModelRequest    <error>                                FAIL (failed attempts only)
 */
import { clock, labelFor } from "./config.mjs";
import {
  beginSession,
  beginTask,
  cleanAssistantText,
  noteAssistant,
} from "./panel-state.mjs";
import {
  doneMessage,
  errorMessage,
  permissionMessage,
  sessionClosedMessage,
  sessionOpenedMessage,
  stepMessage,
  stoppedMessage,
  subagentFinishedMessage,
  subagentStartedMessage,
  taskMessage,
  toolStartedMessage,
} from "./messages.mjs";

/**
 * @typedef {import("./config.mjs").Config} Config
 * @typedef {import("./panel-state.mjs").PanelState} PanelState
 * @typedef {import("./payloads.mjs").Payload} Payload
 * @typedef {{payload: Payload, urgent: boolean}} HookAction
 */

/** Tools whose hook traffic is transport, not a step worth mirroring. */
const IGNORED_TOOLS = new Set(["write_stdin"]);

/** Strip the wrapper Codex adds around expanded pasted content. */
function cleanPrompt(text) {
  return String(text ?? "")
    .replace(/<pasted_content[^>]*>/gi, " ")
    .replace(/<\/pasted_content>/gi, " ");
}

/** Commands that are machinery, not work worth mirroring. */
function isIgnoredPrompt(prompt) {
  const text = prompt.trim();
  if (!text) return true;
  if (/^\$(?:pushtodisplay[\w:-]*)/i.test(text)) return true;
  if (/^\/pushtodisplay[\w:-]*(\s|$)/i.test(text)) return true;
  if (/^\/(?:clear|compact)(\s|$)/i.test(text)) return true;
  return false;
}

/** Read a string field from an untyped event object. */
function str(event, key) {
  const value = event[key];
  return typeof value === "string" ? value : "";
}

/**
 * Decide whether a Codex `tool_response` represents a failed tool call.
 *
 * Codex passes tool-specific JSON. Shell tools commonly use an `exit_code`
 * (or `exitCode`) field, sometimes under `metadata`; other tools may report
 * `success: false` or an `error`. PostToolUse fires for non-zero shell exits,
 * so this is deliberately best-effort and treats unknown shapes as success.
 *
 * @param {unknown} response
 * @returns {boolean}
 */
export function toolFailed(response) {
  const seen = new Set();

  /** @param {unknown} value @returns {boolean} */
  function visit(value) {
    if (value === null || value === undefined) return false;
    if (typeof value === "string") {
      return /(?:exit(?:ed)?(?: with)?(?: code| status)?|process exited with(?: code)?|status(?: code)?)[:\s]+([1-9]\d*)/i.test(
        value,
      );
    }
    if (typeof value !== "object") return false;
    if (seen.has(value)) return false;
    seen.add(value);

    const obj = /** @type {Record<string, unknown>} */ (value);

    for (const key of ["exit_code", "exitCode"]) {
      if (typeof obj[key] === "number") return obj[key] !== 0;
    }
    for (const key of ["success", "ok"]) {
      if (typeof obj[key] === "boolean") return !obj[key];
    }
    if (typeof obj.status === "string" && /^(?:fail|failed|error|cancelled)$/i.test(obj.status)) {
      return true;
    }
    if (typeof obj.error === "string" && obj.error.trim()) return true;

    for (const key of ["metadata", "meta", "result", "output", "content", "response"]) {
      const child = obj[key];
      if (child !== undefined && visit(child)) return true;
    }

    // Some tools return an array of content parts.
    if (Array.isArray(value)) {
      return value.some((part) => visit(part));
    }
    return false;
  }

  return visit(response);
}

/**
 * Build the entries for one event and update the in-memory session state.
 *
 * @param {Record<string, unknown>} event
 * @param {PanelState} state
 * @param {Config} config
 * @param {{wall?: string}} [opts]
 * @returns {{actions: HookAction[], notice: string}}
 */
export function handleEvent(event, state, config, opts = {}) {
  const wall = opts.wall ?? clock();
  const type = str(event, "hook_event_name");
  /** @type {HookAction[]} */
  const actions = [];
  let notice = "";

  switch (type) {
    case "SessionStart": {
      const source = str(event, "source") || "startup";
      const cwd = str(event, "cwd") || state.cwd || process.cwd();
      state.cwd = cwd;
      state.agent = labelFor({ PUSHTODISPLAY_LABEL: config.label }, cwd);
      // Compaction is not a new session: posting "session opened" again would
      // make every auto-compaction look like a restart.
      if (source === "compact") break;
      beginSession(state, { agent: state.agent, cwd });
      actions.push({
        payload: sessionOpenedMessage({
          panelId: config.panel,
          agent: state.agent,
          wall,
        }),
        urgent: true,
      });
      break;
    }

    case "UserPromptSubmit": {
      const prompt = cleanPrompt(str(event, "prompt"));
      if (isIgnoredPrompt(prompt)) break;
      beginTask(state, prompt);
      actions.push({
        payload: taskMessage({
          panelId: config.panel,
          agent: state.agent,
          wall,
          task: state.task,
          cwd: state.cwd,
        }),
        urgent: true,
      });
      break;
    }

    case "PreToolUse": {
      if (!config.steps) break;
      const toolName = str(event, "tool_name");
      if (!toolName || IGNORED_TOOLS.has(toolName)) break;
      actions.push({
        payload: toolStartedMessage({
          panelId: config.panel,
          agent: state.agent,
          wall,
          toolName,
          args: event.tool_input,
          cwd: state.cwd,
        }),
        urgent: false,
      });
      break;
    }

    case "PostToolUse": {
      if (!config.steps) break;
      const toolName = str(event, "tool_name");
      if (!toolName || IGNORED_TOOLS.has(toolName)) break;
      actions.push({
        payload: stepMessage({
          panelId: config.panel,
          agent: state.agent,
          wall,
          toolName,
          args: event.tool_input,
          cwd: state.cwd,
          ok: !toolFailed(event.tool_response),
        }),
        urgent: false,
      });
      break;
    }

    case "PermissionRequest": {
      // Log the blocking prompt, but never return a permission decision:
      // Codex's normal approval prompt must still reach the user.
      actions.push({
        payload: permissionMessage({
          panelId: config.panel,
          agent: state.agent,
          wall,
          toolName: str(event, "tool_name"),
          args: event.tool_input,
          cwd: state.cwd,
          description: str(
            /** @type {Record<string, unknown>} */ (event.tool_input ?? {}),
            "description",
          ),
        }),
        urgent: true,
      });
      break;
    }

    case "Stop": {
      noteAssistant(state, str(event, "last_assistant_message"));
      actions.push({
        payload: doneMessage({
          panelId: config.panel,
          agent: state.agent,
          wall,
          text: state.lastAssistantText,
        }),
        urgent: true,
      });
      break;
    }

    case "PostModelRequest": {
      // Only failures are news; successful model attempts are noise.
      if (str(event, "status") !== "failed") break;
      actions.push({
        payload: errorMessage({
          panelId: config.panel,
          agent: state.agent,
          wall,
          detail: str(event, "error") || "the model call failed",
        }),
        urgent: true,
      });
      break;
    }

    case "SessionEnd": {
      actions.push({
        payload: sessionClosedMessage({
          panelId: config.panel,
          agent: state.agent,
          wall,
        }),
        urgent: true,
      });
      break;
    }

    case "SubagentStart": {
      if (!config.steps) break;
      const agentType = str(event, "agent_type") || str(event, "agent_id");
      actions.push({
        payload: subagentStartedMessage({
          panelId: config.panel,
          agent: state.agent,
          wall,
          agentType,
        }),
        urgent: false,
      });
      break;
    }

    case "SubagentStop": {
      if (!config.steps) break;
      const agentType = str(event, "agent_type") || str(event, "agent_id");
      actions.push({
        payload: subagentFinishedMessage({
          panelId: config.panel,
          agent: state.agent,
          wall,
          agentType,
        }),
        urgent: false,
      });
      break;
    }

    case "Interrupt": {
      actions.push({
        payload: stoppedMessage({
          panelId: config.panel,
          agent: state.agent,
          wall,
        }),
        urgent: true,
      });
      break;
    }
  }

  return { actions, notice };
}

/** Exposed for tests: the exact cleanup applied to assistant text. */
export { cleanAssistantText };

/** Exposed for tests: whether a prompt is machinery rather than work. */
export { isIgnoredPrompt, cleanPrompt };
