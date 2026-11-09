/**
 * Human-readable, present-tense one-liners describing a Codex tool call.
 *
 * The board is read from a distance by a person who does not know what a
 * "tool call" is, so everything here aims at plain language:
 *
 *   Bash        "npm test | head"          -> "running npm test"
 *   apply_patch "*** Begin Patch..."       -> "applying a patch"
 *   Read        "/Users/me/proj/src/a.ts"  -> "reading src/a.ts"
 *   Edit        {file_path, old_string…}   -> "editing src/a.ts (+8 −3)"
 *   spawn_agent {message: "Review auth"}   -> "delegating: Review auth"
 *
 * Paths are shortened against the session cwd (then $HOME) because absolute
 * paths crowd out the part of the string that identifies the file.
 */
import * as path from "node:path";

import { truncate } from "./config.mjs";

/**
 * Longest tool description, in characters.
 *
 * A step line is `session description STATUS time`, which at `medium` runs
 * to ~35 characters per row — so a 48-character description keeps the whole
 * entry around two rows.
 */
export const MAX_DESC = 48;

/**
 * @typedef {object} DescribeOpts
 * @property {string} [cwd] Session cwd — absolute paths inside it become relative.
 * @property {string} [home] Home directory override (defaults to $HOME).
 * @property {number} [max] Character budget for the description.
 */

/** @typedef {Record<string, unknown>} Args */

/** @param {unknown} args @returns {Args} */
const toArgs = (args) =>
  args && typeof args === "object" && !Array.isArray(args)
    ? /** @type {Args} */ (args)
    : {};

/** First non-empty string among `keys`. */
function str(a, keys) {
  for (const k of keys) {
    const v = a[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return "";
}

/**
 * Shorten a path against the cwd, then $HOME.
 * @param {string} p
 * @param {DescribeOpts} [opts]
 */
export function shortenPath(p, opts = {}) {
  if (!p) return "";
  let out = p;
  const cwd = opts.cwd;
  if (cwd && path.isAbsolute(out)) {
    const rel = path.relative(cwd, out);
    if (rel === "") out = ".";
    else if (!rel.startsWith("..") && !path.isAbsolute(rel)) out = rel;
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

/** True for a path-like word in free text. */
function looksLikePath(part) {
  return part.startsWith("/") || /^[A-Za-z]:[\\/]/.test(part);
}

/**
 * Shorten any absolute paths inside free text.
 *
 * Prompts are pasted, not written: a user drops a temp-file path in, and 60
 * characters of UUID then occupy the whole panel. Only path-looking words are
 * touched, so prose and URLs survive.
 */
export function tidyText(text, opts = /** @type {DescribeOpts} */ ({})) {
  return String(text ?? "")
    .split(/(\s+)/)
    .map((part) => (looksLikePath(part) ? shortenPath(part, opts) : part))
    .join("");
}

/**
 * Reduce a shell command to the interesting part: drop the leading `cd` guard,
 * env assignments, redirections, and the boilerplate `| head`/`| tail` tail.
 */
export function cleanCommand(command) {
  const line =
    String(command ?? "")
      .split("\n")
      .map((l) => l.trim())
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
 * (`git push`, `npm test`) and drops the arguments — at this width the arguments
 * are the part nobody reads.
 */
function summariseCommand(command, max = MAX_DESC) {
  if (command.length <= max - 8) return command;
  const words = command.split(" ").filter(Boolean);
  const program = words[0] ?? "";
  const sub = words[1] ?? "";
  const bare = /^[A-Za-z][A-Za-z0-9:._-]*$/.test(sub) && sub.length <= 12;
  return bare ? `${program} ${sub}` : program;
}

/**
 * Fit a file name into a budget without losing its extension —
 * `pasted-image-2026110….png` still says what the file was.
 */
function fitName(name, budget) {
  if (name.length <= budget) return name;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && name.length - dot <= 8 ? name.slice(dot) : "";
  const room = Math.max(1, budget - 1 - ext.length);
  return name.slice(0, room) + "…" + ext;
}

const lineCount = (v) =>
  typeof v === "string" && v.length ? v.split("\n").length : 0;

/** "+N −M" for an edit, based on the replacement text it carries. */
function diffStat(a) {
  const added = lineCount(a.newString ?? a.newText ?? a.new_string ?? a.content);
  const removed = lineCount(a.oldString ?? a.oldText ?? a.old_string);
  if (!added && !removed) return "";
  return ` (+${added} −${removed})`;
}

const PATH_VERBS = {
  read: "reading",
  read_file: "reading",
  write: "writing",
  write_file: "writing",
  edit: "editing",
  multiedit: "editing",
  create: "creating",
  delete: "deleting",
  move: "moving",
};

const PATH_KEYS = ["filePath", "file_path", "path", "file", "target"];

/** A Codex MCP tool name (`mcp__server__tool`) rendered as `server: tool`. */
function describeMcp(toolName, a, max) {
  const parts = toolName.slice(5).split("__");
  const server = parts.shift() ?? "mcp";
  const tool = parts.join("__") || "tool";
  const args = Object.keys(a).slice(0, 2);
  const detail = args.length
    ? ` (${args.map((k) => `${k}: ${truncate(String(a[k]), 20)}`).join(", ")})`
    : "";
  return truncate(`${server}: ${tool}${detail}`, max);
}

/** Build the display string for a tool call. Never empty. */
export function describeTool(toolName, args, opts = {}) {
  const max = opts.max ?? MAX_DESC;
  const raw = String(toolName ?? "").trim() || "tool";
  const name = raw.toLowerCase();
  const a = toArgs(args);
  const rel = (p) => shortenPath(p, opts);
  const verb = PATH_VERBS[name];
  const p = str(a, PATH_KEYS);

  if (name.startsWith("mcp__")) return describeMcp(raw, a, max);

  if (verb && p) {
    const stat = name === "edit" || name === "multiedit" ? diffStat(a) : "";
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

  switch (name) {
    case "bash":
    case "shell":
    case "exec_command":
    case "shell_command": {
      const cmd = str(a, ["command", "cmd", "script"]);
      if (cmd) return truncate(`running ${summariseCommand(cleanCommand(cmd), max)}`, max);
      break;
    }
    case "write_stdin":
      return "waiting for command output";
    case "apply_patch":
    case "patch":
      return "applying a patch";
    case "grep":
    case "search": {
      const pattern = str(a, ["pattern", "query", "regex"]);
      const where = str(a, ["path", "glob", "include"]);
      if (pattern) {
        return truncate(`searching for ${pattern}${where ? ` in ${rel(where)}` : ""}`, max);
      }
      break;
    }
    case "glob":
    case "find": {
      const pattern = str(a, ["pattern", "glob", "query"]);
      if (pattern) return truncate(`finding ${pattern}`, max);
      break;
    }
    case "list":
    case "ls":
      return truncate(`listing ${rel(str(a, ["path", "dir", "directory"])) || "."}`, max);
    case "websearch":
    case "web_search":
    case "search_web": {
      const q = str(a, ["query", "q", "search"]);
      if (q) return truncate(`searching the web for ${q}`, max);
      break;
    }
    case "webfetch":
    case "web_fetch":
    case "fetch":
    case "curl": {
      const url = str(a, ["url", "uri", "href"]);
      if (url) return truncate(`fetching ${url.replace(/^https?:\/\//, "")}`, max);
      break;
    }
    case "todowrite":
    case "todoread":
    case "todo_write":
    case "todo_read":
    case "todo":
    case "update_plan":
      return "updating the plan";
    case "task":
    case "agent":
    case "spawn_agent": {
      const d = str(a, ["description", "prompt", "task", "message"]);
      return truncate(`delegating${d ? `: ${d}` : " to a subagent"}`, max);
    }
    case "skill":
      return "loading a skill";
    case "question":
      return "asking you a question";
  }

  // Generic fallback: keep the tool name visible, show what it was given.
  const keys = Object.keys(a).slice(0, 3);
  if (!keys.length) return raw;
  const parts = keys.map((k) => `${k}: ${truncate(String(a[k]), 24)}`).join(", ");
  return truncate(`${raw}(${parts})`, max);
}

/**
 * The body of a permission line: what the agent wants to do.
 *
 * Codex puts a human-readable approval reason in `tool_input.description` when
 * it has one. Otherwise use the same tool description as the step lines, with
 * an "Allow" prefix.
 */
export function describePermission(toolName, args, opts = {}) {
  const a = toArgs(args);
  const description = str(a, ["description"]);
  const tool = String(toolName ?? "").trim() || "tool";
  if (description) return truncate(`Allow ${tool}: ${description}`, MAX_DESC);
  const command = str(a, ["command", "cmd"]);
  if (command) {
    const body =
      tool.toLowerCase() === "bash"
        ? summariseCommand(cleanCommand(command), MAX_DESC)
        : truncate(command, MAX_DESC);
    return truncate(`Allow ${tool}: ${body}`, MAX_DESC);
  }
  const pathArg = str(a, PATH_KEYS);
  if (pathArg) return truncate(`Allow ${tool}: ${shortenPath(pathArg, opts)}`, MAX_DESC);
  return truncate(`Allow ${describeTool(tool, args, opts)}`, MAX_DESC);
}
