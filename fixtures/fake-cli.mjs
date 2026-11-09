#!/usr/bin/env node
/**
 * A tiny stand-in for the pushtodisplay CLI used by the tests.
 *
 * It records every `send` argv as one JSON line and answers `auth status
 * --json` with an authenticated result unless FAKE_CLI_AUTH=no.
 */
import { appendFileSync } from "node:fs";

const args = process.argv.slice(2);

if (args[0] === "auth" && args[1] === "status") {
  const authenticated = process.env.FAKE_CLI_AUTH !== "no";
  process.stdout.write(JSON.stringify({ authenticated }) + "\n");
  process.exit(0);
}

if (args[0] === "send") {
  const log = process.env.FAKE_CLI_LOG;
  if (!log) {
    process.stderr.write("FAKE_CLI_LOG is not set\n");
    process.exit(1);
  }
  appendFileSync(log, JSON.stringify(args) + "\n");
  process.exit(0);
}

process.stderr.write(`unsupported fake CLI command: ${args.join(" ")}\n`);
process.exit(1);
