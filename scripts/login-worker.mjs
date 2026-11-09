#!/usr/bin/env node
/**
 * Background device-code login worker.
 *
 * Started detached by `scripts/command.mjs login` so the skill can print the
 * URL and code immediately. The worker runs the real CLI, appends its output to
 * the login log, and records a successful login in the shared auth cache so the
 * next hook re-enables sending without a restart.
 */
import { createWriteStream } from "node:fs";
import { spawn } from "node:child_process";

import { cliNotFoundMessage, resolveCli } from "../lib/cli-adapter.mjs";
import { writeAuth } from "../lib/state.mjs";

const logPath = process.argv[2];
if (!logPath) process.exit(1);

const out = createWriteStream(logPath, { flags: "a", mode: 0o600 });
out.on("error", () => {});
const cmd = resolveCli();
const child = spawn(cmd.exe, [...cmd.prefix, "auth", "login", "--device-code"], {
  stdio: ["ignore", "pipe", "pipe"],
  env: process.env,
});

child.stdout?.pipe(out, { end: false });
child.stderr?.pipe(out, { end: false });

child.on("error", (err) => {
  out.write(`\n[pushtodisplay] login failed to start: ${err.message}\n`);
  out.write(`[pushtodisplay] ${cliNotFoundMessage()}\n`);
  out.end();
});

child.on("exit", async (code) => {
  if (code === 0) {
    try {
      await writeAuth({ status: "ok", at: Date.now() });
    } catch {
      // The CLI's own credentials are still valid; the cache is only a hint.
    }
    out.write("\n[pushtodisplay] login successful\n");
  } else {
    out.write(`\n[pushtodisplay] login failed (exit ${code ?? "unknown"})\n`);
  }
  out.end();
});
