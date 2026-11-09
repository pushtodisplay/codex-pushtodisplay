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

### From the repository marketplace

```bash
codex plugin marketplace add pushtodisplay/codex-pushtodisplay
codex plugin add pushtodisplay@pushtodisplay
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

### Finish setup

Run the setup skill in Codex:

```text
$pushtodisplay:setup
```

It logs you in if needed, sends a test entry, and records that this Codex
integration is set up. The plugin includes its own Push To Display CLI; do not
install a separate CLI. Installation alone does not send anything: a login from
another integration on the same machine does not enable Codex until this setup
step runs.

If the skill picker does not show it, ask Codex to “set up Push To Display” or
invoke `$pushtodisplay:setup` directly.

### Requirements

- **Codex CLI 0.167.x** — plugin-bundled lifecycle hooks.
- **Node.js 18+** — the hook is plain ESM with no build step.
- **A Push To Display account** — the setup skill opens the device-code login.
- **No separate CLI install** — the plugin bundles the CLI it needs.

## Quick start

1. Install from the repository marketplace.
2. Open `/hooks` and trust the `pushtodisplay` hooks.
3. Run `$pushtodisplay:setup`.
4. Start a new Codex session.

The board shows the session opening, what it is working on, each finished tool
step, approvals that need you, errors, and when it ends.

## Skills

Codex 0.167.x exposes plugin actions as skills. The setup skill is the only
required one:

| Skill | Action |
| --- | --- |
| `$pushtodisplay:setup` | Log in if needed, send a test entry, and mark this Codex integration as set up. |
| `$pushtodisplay:pushtodisplay-status` | Show auth, setup, board, panel, and label. |
| `$pushtodisplay:pushtodisplay-test` | Send a test entry. |
| `$pushtodisplay:pushtodisplay-clear` | Write a `log cleared` entry. |

`setup` is the supported entry point. `status`, `test`, and `clear` are optional
diagnostics. The plugin includes the CLI it needs; users do not install or invoke
a separate `pushtodisplay` CLI.

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
3. Run `$pushtodisplay:setup`. A fresh install sends nothing until this setup
   step has completed, even if another integration already logged in.
4. Run `$pushtodisplay:pushtodisplay-status` and check the resolved board,
   panel, auth, and setup state.
5. Run `$pushtodisplay:pushtodisplay-test` and look for the `link OK` line.

**Updates stop after working for a while.**

Auth is known-bad and the plugin drops rather than buffers. Run
`$pushtodisplay:setup` (or `$pushtodisplay:pushtodisplay-login` if setup is
already complete). Sending resumes on the next event; the plugin re-probes at
most every 20 seconds and a successful login re-enables it immediately.

**`Push To Display CLI not found`.**

The plugin bundles its own CLI. If it is missing, the plugin files are
incomplete; reinstall the plugin. Do not install a separate `pushtodisplay` CLI.

**Final lines (`STOP`, `ENDED`) are missing.**

`Interrupt` and `SessionEnd` are allowed at most three seconds by Codex. A slow
network or a known-bad auth probe can consume that budget. The hook leaves
unsent queue entries for the next event; run setup/status if it persists.

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
| `plugin.json` | Codex plugin manifest: identity and `skills`. The `$schema` field is intentionally omitted; Codex 0.167 treats it as the portable format and does not load bundled hooks in that mode. |
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
| `lib/sender.mjs` | Apply an event, require setup + auth, drain the queue. |
| `lib/hook-events.mjs` | Codex hook event -> message mapping. |
| `lib/setup-state.mjs` | Per-Codex setup marker; prevents shared credentials from silently enabling Codex. |
| `scripts/pushtodisplay.mjs` | Internal setup/status helper used by the skills. |
| `vendor/pushtodisplay/` | Pinned `pushtodisplay` CLI 0.1.19; no install step needed. |
| `skills/` | Usage guidance and action skills. |
| `docs/distribution.md` | Alternative npm/developer paths and the public-directory blocker. |
| `docs/publishing.md` | First publish and ongoing release steps. |
| `.github/workflows/publish.yml` | OIDC/Trusted Publishing release workflow. |

### Validating the plugin

```bash
codex --version
codex plugin marketplace add "$PWD"
codex plugin list
codex plugin add pushtodisplay@pushtodisplay
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
