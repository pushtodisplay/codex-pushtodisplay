// @ts-check
/**
 * Human-readable, present-tense one-liners describing a Codex tool call, plus
 * the small amount of judgement needed to tell a finished step from a failed
 * one.
 *
 *   Bash "npm test | head"            -> "running npm test"
 *   apply_patch "*** Update File: a"  -> "editing a (+8 −3)"
 *   read_file "/repo/src/a.ts"        -> "reading src/a.ts"
 *   mcp__linear__list_issues          -> "using linear.list_issues"
 *
 * Paths are shortened against the session cwd (then $HOME) because absolute
 * paths crowd out the part of the string that identifies the file.
 */
import * as path from "node:path";

import { truncate } from "./config.mjs";

/**
 * Longest tool description, in characters. A step line is
 * `agent description STATUS time`; 48 characters keeps it around two rows at
 * the board's default type size.
 */
export const MAX_DESC = 48;

/**
 * @typedef {object} DescribeOpts
 * @property {string} [cwd] Session cwd — absolute paths inside it become relative.
 * @property {string} [home] Home directory override (defaults to $HOME).
 * @property {number} [max] Character budget (defaults to MAX_DESC).
 */

/** @typedef {Record<string, unknown>} Args */

/**
 * @param {unknown} args
 * @returns {Args}
 */
function toArgs(args) {
  return args && typeof args === "object" && !Array.isArray(args)
    ? /** @type {Args} */ (args)
    : {};
}

/**
 * First non-empty string among `keys`.
 * @param {Args} args
 * @param {string[]} keys
 * @returns {string}
 */
function str(args, keys) {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

/**
 * Shorten a path against the cwd, then $HOME.
 * @param {string} p
 * @param {DescribeOpts} [opts]
 * @returns {string}
 */
export function shortenPath(p, opts = {}) {
  if (!p) return "";
  let out = p;
  const cwd = opts.cwd;
  if (cwd && path.isAbsolute(out)) {
    const rel = path.relative(cwd, out);
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) out = rel;
  }
  const home = opts.home ?? process.env.HOME ?? "";
  if (home && path.isAbsolute(out) && (out === home || out.startsWith(home + path.sep))) {
    out = "~" + out.slice(home.length);
  }
  // Still absolute (a temp dir, another volume): the leading directories are
  // pure noise on a 48-character line, so keep only what names the file.
  if (path.isAbsolute(out) && out !== "~") out = "…/" + path.basename(out);
  return out;
}

/**
 * Shorten any absolute paths inside free text. Prompts are pasted, not written:
 * a temp-file path can otherwise eat the whole panel.
 * @param {string} text
 * @param {DescribeOpts} [opts]
 * @returns {string}
 */
export function tidyText(text, opts = {}) {
  return text
    .split(/(\s+)/)
    .map((part) => (part.startsWith("/") ? shortenPath(part, opts) : part))
    .join("");
}

/**
 * Reduce a shell command to the interesting part: drop the leading `cd` guard,
 * env assignments, redirections, and the boilerplate `| head`/`| tail` tail.
 * @param {string} command
 * @returns {string}
 */
export function cleanCommand(command) {
  const line =
    command
      .split("\n")
      .map((part) => part.trim())
      .find(Boolean) ?? "";
  let c = line;
  c = c.replace(/^cd\s+("[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*/, "");
  c = c.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, "");
  c = c.replace(/\s*\|\s*(?:head|tail)(?:\s+-n?\s*\d+)?\s*$/, "");
  c = c.replace(/\s+2>&1\s*$/, "");
  c = c.replace(/\s+>+\s*\S+\s*$/, "");
  return c.replace(/\s+/g, " ").trim();
}

/**
 * A command too long to read keeps the program and its bare subcommand
 * (`git push`, `npm test`) and drops the arguments.
 * @param {string} command
 * @param {number} [max]
 * @returns {string}
 */
function summariseCommand(command, max = MAX_DESC) {
  if (command.length <= max - 8) return command;
  const words = command.split(" ").filter(Boolean);
  const program = words[0] ?? "";
  const sub = words[1] ?? "";
  // A subcommand is a short bare word: `test`, `push`, `run`. A long token is
  // an argument (a pattern, a hash) and would only be truncated later anyway.
  const bare = /^[A-Za-z][A-Za-z0-9:._-]*$/.test(sub) && sub.length <= 12;
  return bare ? `${program} ${sub}` : program;
}

/**
 * Fit a file name into a budget without losing its extension.
 * @param {string} name
 * @param {number} budget
 * @returns {string}
 */
function fitName(name, budget) {
  if (name.length <= budget) return name;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && name.length - dot <= 8 ? name.slice(dot) : "";
  const room = Math.max(1, budget - 1 - ext.length);
  return name.slice(0, room) + "…" + ext;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function lineCount(value) {
  return typeof value === "string" && value.length ? value.split("\n").length : 0;
}

/**
 * "+N −M" for an edit, based on the replacement text it carries.
 * @param {Args} args
 * @returns {string}
 */
function diffStat(args) {
  const added = lineCount(args.newText ?? args.new_string ?? args.content ?? args.new_source);
  const removed = lineCount(args.oldText ?? args.old_string ?? args.old_source);
  if (!added && !removed) return "";
  return ` (+${added} −${removed})`;
}

/**
 * Read a Codex apply_patch payload: the patch text lives in `command`.
 * @param {string} patch
 * @returns {{ action: string, file: string, added: number, removed: number } | null}
 */
export function patchSummary(patch) {
  if (!patch) return null;
  let action = "";
  let file = "";
  for (const line of patch.split("\n")) {
    const match = /^\*\*\* (Update|Add|Delete) File: (.+)$/.exec(line);
    if (match) {
      action = (match[1] ?? "").toLowerCase();
      file = (match[2] ?? "").trim();
      break;
    }
  }
  if (!action || !file) return null;
  let added = 0;
  let removed = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) removed += 1;
  }
  return { action, file, added, removed };
}

/** @type {Record<string, string>} */
const PATH_VERBS = {
  read: "reading",
  read_file: "reading",
  readimage: "viewing",
  view: "viewing",
  view_image: "viewing",
  write: "writing",
  write_file: "writing",
  edit: "editing",
  edit_file: "editing",
  multiedit: "editing",
  multi_edit: "editing",
  notebookedit: "editing",
  notebook_edit: "editing",
  create: "creating",
  create_file: "creating",
  delete: "deleting",
  delete_file: "deleting",
  move: "moving",
  move_file: "moving",
};

/** @type {string[]} */
const PATH_KEYS = [
  "path",
  "file",
  "filePath",
  "file_path",
  "target",
  "image_path",
  "imagePath",
  "notebook_path",
];

/**
 * Build the display string for a tool call. Never empty.
 * @param {string} toolName
 * @param {unknown} args
 * @param {DescribeOpts} [opts]
 * @returns {string}
 */
export function describeTool(toolName, args, opts = {}) {
  const max = opts.max ?? MAX_DESC;
  const name = String(toolName ?? "");
  const lower = name.toLowerCase();
  const a = toArgs(args);
  /** @param {string} p */
  const rel = (p) => shortenPath(p, opts);
  const verb = PATH_VERBS[lower];
  const p = str(a, PATH_KEYS);
  const command = str(a, ["command", "cmd", "script"]);

  // Codex's file editor is always apply_patch, even when a matcher aliases it
  // as Edit or Write. Read the patch itself so the line names the file.
  if (lower === "apply_patch" || lower === "applypatch" || lower === "patch") {
    const patch = patchSummary(command);
    if (patch) {
      const shown = rel(patch.file);
      const actionVerb =
        patch.action === "add"
          ? "creating"
          : patch.action === "delete"
            ? "deleting"
            : "editing";
      const stat = patch.added || patch.removed ? ` (+${patch.added} −${patch.removed})` : "";
      const slash = shown.lastIndexOf("/");
      const dir = slash >= 0 ? shown.slice(0, slash + 1) : "";
      const base = shown.slice(slash + 1);
      for (const candidate of [
        `${actionVerb} ${shown}${stat}`,
        `${actionVerb} ${shown}`,
        `${actionVerb} ${base}${stat}`,
        `${actionVerb} ${base}`,
      ]) {
        if (candidate.length <= max) return candidate;
      }
      const room = Math.max(4, max - actionVerb.length - 1 - dir.length - stat.length);
      return `${actionVerb} ${dir}${fitName(base, room)}${stat}`;
    }
    return "applying a patch";
  }

  if (verb && p) {
    const stat = lower.startsWith("edit") || lower.startsWith("multi") ? diffStat(a) : "";
    const shown = rel(p);
    const slash = shown.lastIndexOf("/");
    const dir = slash >= 0 ? shown.slice(0, slash + 1) : "";
    const base = shown.slice(slash + 1);
    // Give up detail in a fixed order — the diff stat first, then the directory,
    // and only then abbreviate the file name, which keeps its extension.
    for (const candidate of [
      `${verb} ${shown}${stat}`,
      `${verb} ${shown}`,
      `${verb} ${base}${stat}`,
      `${verb} ${base}`,
    ]) {
      if (candidate.length <= max) return candidate;
    }
    const room = Math.max(4, max - verb.length - 1 - dir.length - stat.length);
    return `${verb} ${dir}${fitName(base, room)}${stat}`;
  }

  // MCP names are `mcp__server__tool` (sometimes with more separators).
  if (lower.startsWith("mcp__")) {
    const parts = name.split("__");
    const server = parts[1] ?? "";
    const tool = parts.slice(2).join("__") || "tool";
    return truncate(server ? `using ${server}.${tool}` : `using ${tool}`, max);
  }

  if (
    lower === "bash" ||
    lower === "shell" ||
    lower === "exec" ||
    lower === "exec_command" ||
    lower === "local_shell" ||
    lower === "run_command" ||
    lower === "command" ||
    lower === "unified_exec" ||
    lower === "container.exec"
  ) {
    if (command) return truncate(`running ${summariseCommand(cleanCommand(command), max)}`, max);
  }

  if (
    lower === "write_stdin" ||
    lower === "send_stdin" ||
    lower === "terminal_input"
  ) {
    const input = str(a, ["chars", "input", "text", "stdin"]);
    return truncate(`writing to the terminal${input ? `: ${input}` : ""}`, max);
  }

  if (lower === "grep" || lower === "search" || lower === "search_files" || lower === "file_search") {
    const pattern = str(a, ["pattern", "query", "regex"]);
    const where = str(a, ["path", "glob", "include"]);
    if (pattern) {
      return truncate(`searching for ${pattern}${where ? ` in ${rel(where)}` : ""}`, max);
    }
  }

  if (lower === "glob" || lower === "find" || lower === "find_files" || lower === "list_files") {
    const pattern = str(a, ["pattern", "glob", "query"]);
    if (pattern) return truncate(`finding ${pattern}`, max);
    if (lower === "list_files") {
      return truncate(`listing ${rel(str(a, ["path", "dir", "directory"])) || "."}`, max);
    }
  }

  if (lower === "ls" || lower === "list" || lower === "list_dir" || lower === "list_directory") {
    return truncate(`listing ${rel(str(a, ["path", "dir", "directory"])) || "."}`, max);
  }

  if (lower === "web_search" || lower === "search_web" || lower === "websearch") {
    const query = str(a, ["query", "q", "search"]);
    if (query) return truncate(`searching the web for ${query}`, max);
  }

  if (
    lower === "web_fetch" ||
    lower === "fetch" ||
    lower === "fetch_url" ||
    lower === "open_url" ||
    lower === "curl"
  ) {
    const url = str(a, ["url", "uri", "href"]);
    if (url) return truncate(`fetching ${url.replace(/^https?:\/\//, "")}`, max);
  }

  if (
    lower === "update_plan" ||
    lower === "plan" ||
    lower === "todo_write" ||
    lower === "todo" ||
    lower === "set_plan"
  ) {
    return "updating the plan";
  }

  if (
    lower === "task" ||
    lower === "agent" ||
    lower === "spawn_agent" ||
    lower === "delegate" ||
    lower === "subagent"
  ) {
    const description = str(a, ["description", "prompt", "task", "message"]);
    return truncate(`delegating${description ? `: ${description}` : " to a subagent"}`, max);
  }

  if (lower === "tool_search" || lower === "search_tools" || lower === "tool_search_tool") {
    const query = str(a, ["query", "q"]);
    return truncate(`looking up a tool${query ? ` for ${query}` : ""}`, max);
  }

  if (lower === "mcp" || lower === "call_tool") {
    const server = str(a, ["server", "server_name"]);
    const tool = str(a, ["tool", "tool_name", "name"]);
    if (server || tool) return truncate(`using ${[server, tool].filter(Boolean).join(".")}`, max);
  }

  // Generic fallback: keep the tool name visible, show what it was given.
  const keys = Object.keys(a).slice(0, 3);
  if (!keys.length) return name;
  const parts = keys.map((key) => `${key}: ${truncate(String(a[key]), 24)}`).join(", ");
  return truncate(`${name}(${parts})`, max);
}

/**
 * The body of a PermissionRequest line. Codex supplies a human-readable
 * `tool_input.description` for many approvals; otherwise describe the command
 * or tool in the same words a step line uses.
 * @param {string} toolName
 * @param {unknown} toolInput
 * @param {DescribeOpts} [opts]
 * @returns {string}
 */
export function describePermission(toolName, toolInput, opts = {}) {
  const max = opts.max ?? 60;
  const name = String(toolName ?? "tool");
  const lower = name.toLowerCase();
  const a = toArgs(toolInput);
  const description = str(a, ["description"]);
  if (description) return truncate(description, max);

  if (lower === "bash" || lower === "shell" || lower === "exec_command" || lower === "exec") {
    const command = cleanCommand(str(a, ["command", "cmd", "script"]));
    if (command) {
      return truncate(`Allow bash: ${summariseCommand(command, max - 12)}`, max);
    }
  }

  if (lower === "apply_patch" || lower === "edit" || lower === "write") {
    const patch = patchSummary(str(a, ["command"]));
    if (patch) return truncate(`Allow apply_patch: ${shortenPath(patch.file, opts)}`, max);
    return "Allow apply_patch";
  }

  if (lower.startsWith("mcp__")) {
    const parts = name.split("__");
    const server = parts[1] ?? "";
    const tool = parts.slice(2).join("__") || "tool";
    return truncate(`Allow ${server ? `${server}.${tool}` : tool}`, max);
  }

  return truncate(`Allow ${name}`, max);
}

/**
 * Whether a finished tool call looks like a failure. Codex normalizes Bash's
 * `tool_response` to the command's output text, so an explicit non-zero exit
 * marker is the strongest signal; MCP and function tools may return structured
 * error fields instead.
 * @param {unknown} response
 * @returns {boolean}
 */
export function isToolFailure(response) {
  if (typeof response === "string") {
    const text = response;
    if (/\bProcess exited with code\s+([1-9]\d*)/.test(text)) return true;
    if (/\b(?:command|process|shell)\s+(?:exited|terminated)\s+with\s+(?:exit\s+)?(?:code|status)\s+([1-9]\d*)/i.test(text)) {
      return true;
    }
    if (/\bexit(?:ed)?\s+(?:code|status)\s*[:=]?\s*([1-9]\d*)/i.test(text)) return true;
    if (/\bexit code\s*[:=]\s*([1-9]\d*)/i.test(text)) return true;
    if (/apply_patch verification failed/i.test(text)) return true;
    if (/\bcommand failed\b/i.test(text)) return true;
    if (/^(?:error|fatal)\b[:\s]/im.test(text)) return true;
    if (/^FAIL\b/m.test(text)) return true;
    if (/\b[1-9]\d* (?:tests? )?(?:fail(?:ed|ing)|errors?)\b/i.test(text)) return true;
    if (/\bTests?:\s+.*\b[1-9]\d* failed/i.test(text)) return true;
    if (/\b(?:AssertionError|TypeError|ReferenceError|SyntaxError)\b/.test(text)) return true;
    if (/^npm ERR!/m.test(text)) return true;
    if (/^not ok\b/m.test(text)) return true;
    if (/^ERROR\b/m.test(text)) return true;
    if (/^error\[/m.test(text)) return true;
    if (/\bSegmentation fault\b/.test(text) || /^Killed\b/m.test(text)) return true;
    if (/^Traceback \(most recent call last\)/m.test(text)) return true;
    if (/\bcommand not found\b/i.test(text)) return true;
    if (/\bNo such file or directory\b/i.test(text)) return true;
    if (/^(?:panic:|error TS\d+)/m.test(text)) return true;
    return false;
  }

  if (!response || typeof response !== "object") return false;
  const r = /** @type {Args} */ (response);
  if (r.success === false || r.ok === false) return true;
  if (r.is_error === true || r.isError === true) return true;
  if (r.error) return true;
  const status = typeof r.status === "string" ? r.status.toLowerCase() : "";
  if (status === "error" || status === "failed" || status === "failure") return true;
  for (const key of ["exit_code", "exitCode", "code"]) {
    const value = r[key];
    if (typeof value === "number" && Number.isInteger(value) && value !== 0) return true;
  }
  if (typeof r.output === "string" && isToolFailure(r.output)) return true;
  if (typeof r.stdout === "string" && isToolFailure(r.stdout)) return true;
  if (Array.isArray(r.content)) {
    return r.content.some((item) => isToolFailure(item));
  }
  return false;
}
