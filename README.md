# codex-pushtodisplay

**Push To Display** plugin for [Codex](https://developers.openai.com/codex/) — mirrors your agent's activity onto your Push To Display board in real time.

A panel is a **shared scrolling log** (1 of 4). Every entry is its own message,
newest at the top, and every entry has the same shape:

```
<agent> <what happened> <STATUS> <HH:MM>
```

```
release session closed ENDED 12:10
release Pinned the clock so the release test passes. DONE 12:09
release Allow bash: git push --force-with-lease NEEDS 12:08
release running grep FAIL 12:07
release running ls -1 src OK 12:07
release fix the flaky release test RUN 12:06
release session opened READY 12:06
```

The status word is a **closed** vocabulary — `READY`, `RUN`, `OK`, `FAIL`,
`NEEDS`, `DONE`, `STOP`, `ENDED` — so a line can never invent its own state.
`READY` and `ENDED` bracket a session; `FAIL` means a finished step or the model
failed; `STOP` means you interrupted; `NEEDS` is the one status that wants a
human. There are no icons to decode.

## What gets posted

| Codex hook | Entry | Status |
| --- | --- | --- |
| `SessionStart` (`startup`, `resume`, `clear`, `fork`) | `session opened` | `READY` |
| `UserPromptSubmit` | the prompt | `RUN` |
| `PostToolUse` | `running npm test` | `OK` / `FAIL` |
| `PermissionRequest` | `Allow bash: git push` | `NEEDS` |
| `Stop` | the last assistant message | `DONE` |
| `Interrupt` | `interrupted before it finished` | `STOP` |
| `SessionEnd` | `session closed` | `ENDED` |
| `PostModelRequest` with `status: failed` | the error | `FAIL` |

What is deliberately silent:

- **Compaction.** `SessionStart` with `source: compact` is housekeeping, not a
  new session.
- **Subagent tool loops.** `PostToolUse` events carrying `agent_id`/`agent_type`
  are inner work, not the main thread's trail.
- **Successful model attempts.** Only a failed `PostModelRequest` is news.
- **Turn boundaries, mid-run chatter, and approvals that were answered.** They
  are facts about machinery, not about work.

`PUSHTODISPLAY_STEPS=0` also drops the per-tool lines, leaving milestones only.

Three bodies are shortened by structure first:

| Body | Rule |
| --- | --- |
| tool description | 48 characters; a long command keeps its program and subcommand (`running grep`), a long path drops its directory before its file name |
| prompt | first usable sentence, 60 characters, ellipsis at a word boundary when possible |
| result | same rule as the prompt |

`DONE` quotes the agent's own closing text. It never reports counters ("ran 5
tools") because a counter answers a question nobody asked.

## Install

There are two supported distribution paths: the **repository marketplace** and
**npm**. The public OpenAI Plugins Directory is not available because it rejects
plugin packages that contain lifecycle hooks; this plugin is hooks-based. See
[docs/distribution.md](docs/distribution.md) for the full explanation.

### From the repository marketplace

```bash
codex plugin marketplace add pushtodisplay/codex-pushtodisplay
codex plugin add pushtodisplay@pushtodisplay
```

### From npm

The published package is `codex-pushtodisplay`. It vendors the pinned
`pushtodisplay` CLI 0.1.19, so an npm-source install carries its own CLI. Add a
personal marketplace entry with an npm source, then install:

```bash
mkdir -p ~/.agents/plugins
cat > ~/.agents/plugins/marketplace.json <<'JSON'
{
  "name": "pushtodisplay-npm",
  "interface": { "displayName": "Push To Display (npm)" },
  "plugins": [
    {
      "name": "pushtodisplay",
      "source": {
        "source": "npm",
        "package": "codex-pushtodisplay",
        "version": "0.1.0"
      },
      "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
      "category": "Productivity"
    }
  ]
}
JSON
codex plugin add pushtodisplay@pushtodisplay-npm
```

If `~/.agents/plugins/marketplace.json` already exists, merge the plugin entry
into its `plugins` array instead of replacing the file. Codex reads the personal
marketplace automatically; `codex plugin marketplace list` shows what it sees.

### From a local checkout

```bash
git clone https://github.com/pushtodisplay/codex-pushtodisplay.git
cd codex-pushtodisplay
npm ci
codex plugin marketplace add "$PWD"
codex plugin add pushtodisplay@pushtodisplay
```

The plugin vendors the pinned `pushtodisplay` CLI, so `npm ci` is only needed
for development. The hook resolves the vendored copy first; a binary on `PATH`
and the pinned npx fallback remain available.

Inspect the result:

```bash
codex plugin marketplace list
codex plugin list
```

### Trust the hooks

Codex **does not run plugin hooks until you review them**. Plugin-bundled hooks
are non-managed hooks and are skipped until trusted. After installing:

1. Open `/hooks` in the Codex CLI (or **Settings > Hooks** in the desktop app).
2. Review the `pushtodisplay` hook source.
3. Trust the current definition.

Trust is recorded against the hook definition and the plugin's content hash. A
plugin update that changes `hooks/hook.mjs` requires a new review even when the
hook definition itself is unchanged. For one-off automation that already vets
hook sources outside Codex, `--dangerously-bypass-hook-trust` skips the trust
prompt for that invocation.

### Requirements

- **Codex CLI 0.167.x** (hooks, including plugin-bundled hooks).
- **Node.js 18+** — the hook is plain ESM with no build step.
- **The `pushtodisplay` CLI.** Resolution order:
  1. the vendored `vendor/pushtodisplay` CLI (or an installed
     `node_modules/pushtodisplay` dependency);
  2. a `pushtodisplay` binary on `PATH`;
  3. `npx --yes pushtodisplay@0.1.19`.
- **A Push To Display account**, authenticated through the CLI.

The repository-marketplace and npm installs both carry the vendored CLI, so a
separate global install is optional. Set `PUSHTODISPLAY_CLI` to an absolute path
to use a different CLI build. For a global install:

```bash
npm i -g pushtodisplay@0.1.19
pushtodisplay auth login --device-code
```

## Quick start

1. **Log in** (device-code OAuth; opens the browser when possible):

   ```bash
   node scripts/pushtodisplay.mjs login
   ```

   Or use the CLI directly:

   ```bash
   pushtodisplay auth login --device-code
   ```

2. **Verify the wiring** — sends a test entry to the configured panel and board:

   ```bash
   node scripts/pushtodisplay.mjs test
   ```

3. **Check auth and configuration**:

   ```bash
   node scripts/pushtodisplay.mjs status
   ```

Then start a new Codex session. The board shows it opening, what it is working
on, each finished tool step, approvals that need you, errors, and when it ends.

## Commands

Codex 0.167.x plugins bundle **skills**, not shell-backed slash commands. The
stable command surface is therefore a script, and the plugin also exposes each
action as a skill so it appears in the skill/slash picker and can be invoked as
a skill mention on surfaces that support one. In Codex 0.167 the installed
skills are namespaced:

| Skill | Action |
| --- | --- |
| `pushtodisplay:pushtodisplay-login` | OAuth device-code login. |
| `pushtodisplay:pushtodisplay-status` | Show auth and resolved configuration. |
| `pushtodisplay:pushtodisplay-test` | Send a test entry. |
| `pushtodisplay:pushtodisplay-clear` | Write a `log cleared` entry. |

They are also discoverable in the skill list as `pushtodisplay-login`,
`pushtodisplay-status`, `pushtodisplay-test`, and `pushtodisplay-clear`.

The deterministic, model-free path is the bundled helper:

| Command | Description |
| --- | --- |
| `node scripts/pushtodisplay.mjs login` | Start OAuth login (opens browser, shows code). |
| `node scripts/pushtodisplay.mjs status` | Show current auth state, CLI, board, panel, label. |
| `node scripts/pushtodisplay.mjs test` | Send a test update to verify wiring. |
| `node scripts/pushtodisplay.mjs clear` | Write a `log cleared` entry to this panel. |

Run the script from the installed plugin directory, or use the CLI commands
directly (`pushtodisplay auth status --json`, `pushtodisplay send ...`).

> **Legacy note:** `commands/*.md` is included for Codex-compatible installs,
> which expose them as `source-command-*` skills. The skills above and the script
> are the stable surface.

## Configuration

All settings are environment variables, so each Codex process can write to a
different panel:

| Env var | Default | Description |
| --- | --- | --- |
| `PUSHTODISPLAY_BOARD_ID` | *(default board)* | Board ID to send to. |
| `PUSHTODISPLAY_PANEL` | `1` | Which panel (1–4) this agent writes to. |
| `PUSHTODISPLAY_LABEL` | *(cwd basename)* | Agent name in the first field of every line. |
| `PUSHTODISPLAY_STEPS` | *(on)* | Set to `0` to skip per-tool entries (milestones only). |
| `PUSHTODISPLAY_DISABLED` | *(off)* | Set to `1` to disable the plugin entirely. |

An invalid `PUSHTODISPLAY_PANEL` (out of range, fractional, non-numeric) falls
back to 1 rather than failing the hook.

### Multiple agents / panels

Give each parallel agent its own panel and a label:

```bash
PUSHTODISPLAY_PANEL=1 PUSHTODISPLAY_LABEL=cicd codex
PUSHTODISPLAY_PANEL=2 PUSHTODISPLAY_LABEL=qa codex
```

Each panel becomes its own scrolling log. Sharing a panel is fine — the agent
field on every line keeps them apart:

```
qa Allow bash: git push NEEDS 11:41
release running npm test OK 11:40
```

With no explicit label, the label is the working directory's basename, so
launching from two different repos already gives two distinct agents.

## How it works

```
Codex hook event ──► hooks/hook.mjs ──► session state ──► messages ──► queue ──► CLI ──► API
                     (one process)      (~/.cache/…)     (one line)   (ordered,  (OAuth)
                                                                        deduped,
                                                                        ≥1.2s)
```

- **Hooks are one-shot processes.** Codex runs `hooks/hook.mjs` for each event
  with one JSON object on stdin. The hook reads it, updates the session state,
  and exits 0 with no stdout. It never approves, blocks, rewrites, or continues
  anything.
- **State lives in `~/.cache/pushtodisplay/codex/<session_id>.json`**: the task,
  the last assistant text, the pending queue, the last send time, and the auth
  probe. A lock directory serializes concurrent hooks for the same session.
- **Order is the information.** Nothing is reordered. Consecutive duplicate
  lines are suppressed; `A, B, A` still posts both `A`s. The backlog is bounded
  (the oldest non-urgent steps are dropped first), so the log cannot fall
  minutes behind the agent.
- **Spacing.** Sends are separated by at least 1.2 seconds, measured from the
  end of the previous send. This sits safely above the Sandbox tier's ~1 msg/s
  cap and protects the monthly message quota.
- **`PostToolUse` is `async: true`.** Tool loops never wait on the board.
  `Stop`, `Interrupt`, and `SessionEnd` flush synchronously within their hook
  timeouts.
- **Auth gating.** Auth is probed with `auth status --json`. Unknown waits for
  the probe; known-bad drops updates (never buffers them); a stale bad answer is
  re-probed at most once every 20 seconds. A successful login writes a global
  hint, so sessions re-enable immediately.
- **No coalescing.** Every entry is news; nothing is dropped for being
  superseded.

## Behaviour reference

| Situation | Board line |
| --- | --- |
| session starts (new, resumed, cleared, forked) | `<label> session opened READY HH:MM` |
| prompt arrives | `<label> Fix the flaky release test. RUN HH:MM` |
| `Bash` finishes successfully | `<label> running npm test OK HH:MM` |
| `Bash` exits non-zero | `<label> running npm test FAIL HH:MM` |
| `apply_patch` finishes | `<label> editing src/release.ts (+2 −1) OK HH:MM` |
| MCP tool fails | `<label> using linear.create_issue FAIL HH:MM` |
| approval requested | `<label> Allow bash: git push NEEDS HH:MM` |
| turn finishes | `<label> Pinned the clock so the release test passes. DONE HH:MM` |
| user interrupts | `<label> interrupted before it finished STOP HH:MM` |
| provider error | `<label> HTTP 500 from provider FAIL HH:MM` |
| session ends | `<label> session closed ENDED HH:MM` |

Failures are reported, never inferred: a failed step says `FAIL` on its own
line, a provider error says what the provider said, and `STOP` means the user
interrupted. There is no "the run failed" verdict to contradict a turn that
finished.

Codex normalizes a Bash tool's `tool_response` to the command's output and does
not expose its exit code to hooks. The plugin therefore marks a Bash step `FAIL`
when the output carries an explicit failure signal — a non-zero exit marker when
present, `Error:`/`fatal:`/`npm ERR!` lines, a failing test summary, an
`apply_patch` verification error, and similar markers. Structured MCP and
function-tool responses are checked for `isError`, `error`, `success: false`, and
non-zero `exit_code` fields. A command that fails silently (empty output, exit 1)
cannot be distinguished from success by the hook contract and is posted `OK`.

## Troubleshooting

**Nothing appears on the board.**

1. Open `/hooks` and confirm the `pushtodisplay` hook is trusted. A new or
   changed plugin is skipped until reviewed.
2. Check `PUSHTODISPLAY_DISABLED` is not `1`.
3. Run `node scripts/pushtodisplay.mjs status` (or `pushtodisplay auth status
   --json`). Log in if needed.
4. Run `node scripts/pushtodisplay.mjs test` and look for the `link OK` line.
5. Check that the board/panel in status is the one you are watching.

**Updates stop after working for a while.**

Auth is known-bad and the plugin drops rather than buffers. Run the login
command. Sending resumes on the next event; the plugin re-probes at most every
20 seconds and a successful login re-enables it immediately.

**`Push To Display CLI not found`.**

The hook falls back to `npx --yes pushtodisplay@0.1.19`, which can be slow enough to
miss the three-second `Interrupt`/`SessionEnd` budget. Install it globally:

```bash
npm i -g pushtodisplay
```

**Final lines (`STOP`, `ENDED`) are missing.**

`Interrupt` and `SessionEnd` are allowed at most three seconds by Codex. A cold
`npx` download, a slow network, or a known-bad auth probe can consume that
budget. Install the CLI globally and log in; the hook leaves unsent queue
entries for the next event when it runs out of time.

**Too noisy.**

Set `PUSHTODISPLAY_STEPS=0`. Compaction and subagent steps are already silent.

**Wrong label or panel.**

`PUSHTODISPLAY_LABEL` wins over the cwd basename. `PUSHTODISPLAY_PANEL` must be
1–4; anything else falls back to 1. `status` prints the resolved values.

## Development

```bash
npm install
npm run check      # typecheck + lint + tests
npm test           # node:test, fixture-driven
```

The tests cover:

- every hook event fixture -> expected line and status;
- queue order, consecutive dedupe, bounded backlog, spacing, and deadlines;
- auth unknown/known-bad/lazy-retry/login-hint behaviour;
- manifest, hook wiring, marketplace, command, and skill validation.

The plugin is plain JavaScript with JSDoc types. `npm run typecheck` checks the
runtime sources (`lib/`, `hooks/`, `scripts/`) with `tsc --checkJs`; there is no
build step and no generated `dist/`.

### Layout

| Path | Responsibility |
| --- | --- |
| `plugin.json` | Codex plugin manifest: identity, `skills`, `commands`. The `$schema` field is intentionally omitted; Codex 0.167 treats it as the portable format and does not load bundled hooks in that mode. |
| `.codex-plugin/plugin.json` | Codex 0.167 compatibility manifest: `hooks`, `interface`, and `extensions.com.openai.onboardingSkill`. |
| `.agents/plugins/marketplace.json` | Repo marketplace entry (`source.path: "./"`). |
| `hooks/hooks.json` | Lifecycle wiring; `${PLUGIN_ROOT}/hooks/hook.mjs`. |
| `hooks/hook.mjs` | One silent hook process: read stdin, update state, exit 0. |
| `lib/config.mjs` | Env config, label fallback, truncation, clock. |
| `lib/payloads.mjs` | Wire types and the board palette. |
| `lib/messages.mjs` | One-sentence message builders — the visible vocabulary. |
| `lib/describe.mjs` | Tool/approval descriptions and failure detection. |
| `lib/queue.mjs` | Order, dedupe, bounded backlog, ≥1.2 s spacing. |
| `lib/auth-gate.mjs` | Unknown / authed / known-bad, lazy retry, login hint. |
| `lib/cli-adapter.mjs` | CLI resolution, argv mapping, auth probe. |
| `lib/session-state.mjs` | Per-session state, atomic writes, lock. |
| `lib/sender.mjs` | Apply an event, gate auth, drain the queue. |
| `lib/hook-events.mjs` | Codex hook event -> message mapping. |
| `scripts/pushtodisplay.mjs` | Operator CLI: login/status/test/clear. |
| `vendor/pushtodisplay/` | Pinned `pushtodisplay` CLI 0.1.19; no install step needed. |
| `skills/`, `commands/` | Usage guidance and command skills. |
| `docs/distribution.md` | Repo marketplace, npm, and the public-directory blocker. |
| `docs/publishing.md` | First publish and ongoing release steps. |
| `.github/workflows/publish.yml` | OIDC/Trusted Publishing release workflow. |

### Validating the plugin

```bash
npx @openai/codex --version
npx @openai/codex plugin marketplace add "$PWD"
npx @openai/codex plugin list
npx @openai/codex plugin add pushtodisplay@pushtodisplay
```

To inspect hook discovery without touching your real Codex home, use an isolated
`CODEX_HOME`:

```bash
export CODEX_HOME="$(mktemp -d)"
codex plugin marketplace add "$PWD"
codex plugin add pushtodisplay@pushtodisplay --json
codex plugin list --json
```

The installed plugin's `hooks/hooks.json` should appear in Codex's hook list
(`/hooks` in the TUI, or the app-server `hooks/list` method). Bundled hooks
require review in `/hooks` before they run. The Codex CLI can list and install
the plugin without an account; running a turn (and therefore seeing real hook
traffic) requires being signed in to Codex.

## Security

Codex plugins and hooks run with your user's permissions. Review the hook
source (`hooks/hook.mjs` and `lib/`) before trusting it. The plugin only:

- reads the hook event JSON on stdin;
- reads/writes its own state under `~/.cache/pushtodisplay/codex/`;
- invokes the `pushtodisplay` CLI to probe auth and send board updates.

It does not read the transcript, and it prints nothing to stdout.

## License

MIT. PushToDisplay is a product of Goban Source, LLC — see
[pushtodisplay.com](https://pushtodisplay.com).
