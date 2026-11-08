#!/usr/bin/env node
// @ts-check
/**
 * One Codex hook invocation.
 *
 * Codex writes a single JSON object to stdin and reads stdout as an optional
 * control decision. This hook is a mirror: it prints nothing, always exits 0,
 * and therefore never approves, blocks, rewrites, or continues anything.
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { processHookEvent } from "../lib/sender.mjs";

/**
 * @returns {Promise<string>}
 */
async function readStdin() {
  /** @type {Buffer[]} */
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const raw = await readStdin();
  if (!raw.trim()) return;
  /** @type {unknown} */
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return;
  }
  if (!event || typeof event !== "object") return;
  const hookEvent = /** @type {{ hook_event_name?: unknown }} */ (event);
  if (typeof hookEvent.hook_event_name !== "string") return;

  const pluginRoot =
    process.env.PLUGIN_ROOT ||
    process.env.CLAUDE_PLUGIN_ROOT ||
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

  await processHookEvent(/** @type {import("../lib/hook-events.mjs").HookEvent} */ (event), {
    pluginRoot,
  });
}

main().catch(() => {
  // A mirror must never fail a Codex operation. Silent by design.
});
