---
name: pushtodisplay
description: >-
  Help the user use codex-pushtodisplay — the Codex plugin that mirrors agent
  activity onto a Push To Display board. Use whenever the user mentions Push To
  Display, pushing Codex activity to a display board, "pushtodisplay",
  PUSHTODISPLAY_* environment variables, panels on a status board, or a board
  that is not updating.
---

# Push To Display (codex-pushtodisplay)

`codex-pushtodisplay` is a Codex plugin (hooks + commands + skill) that mirrors
agent activity onto a **Push To Display** board (https://pushtodisplay.com) in
real time. A panel is a **shared scrolling log**: one entry per event, newest at
the top, and every entry has the same shape:

```
<agent> <what happened> <STATUS> <HH:MM>
```

```
release session closed ENDED 12:10
release Pinned the clock so the release test passes. DONE 12:09
release Allow bash: git push --force NEEDS 12:08
release running grep FAIL 12:07
release running npm ls -1 src OK 12:07
release fix the flaky release test RUN 12:06
release session opened READY 12:06
```

The status word is a **closed** vocabulary — `READY`, `RUN`, `OK`, `FAIL`,
`NEEDS`, `DONE`, `STOP`, `ENDED` — so a line can never invent its own state.
`READY` and `ENDED` bracket a session; `FAIL` means a step or the model failed;
`STOP` means the user interrupted; `NEEDS` is the one status that wants a human.

Steps are posted when they **finish**, so a line states what actually happened.
`DONE` quotes the agent's own closing text, shortened to its first usable
sentence. The board is not a terminal: code fences, headings, and counters are
not posted.

## What gets posted

| Codex event | Entry | Status |
| --- | --- | --- |
| `SessionStart` (`startup`, `resume`, `clear`, `fork`) | `session opened` | `READY` |
| `UserPromptSubmit` | the task | `RUN` |
| `PostToolUse` | `running npm test` | `OK` / `FAIL` |
| `PermissionRequest` | `Allow bash: git push` | `NEEDS` |
| `Stop` | the last assistant message | `DONE` |
| `Interrupt` | `interrupted before it finished` | `STOP` |
| `SessionEnd` | `session closed` | `ENDED` |
| `PostModelRequest` (`status: failed`) | the error | `FAIL` |

Compaction (`SessionStart` with `source: compact`), subagent tool loops, and
successful model attempts are deliberately silent. `PUSHTODISPLAY_STEPS=0`
drops the per-tool lines as well.

## Installation

```bash
codex plugin marketplace add pushtodisplay/codex-pushtodisplay
codex plugin add pushtodisplay@pushtodisplay
```

For a local checkout:

```bash
codex plugin marketplace add /path/to/codex-pushtodisplay
codex plugin add pushtodisplay@pushtodisplay
```

Then open `/hooks` and trust the bundled `pushtodisplay` hooks. A plugin update
that changes the hook script requires a new review.

## Requirements

- Node.js 18 or newer (the hook and helper are plain ESM; there is no build
  step).
- The `pushtodisplay` CLI: bundled if present in the plugin's `node_modules`,
  otherwise a `pushtodisplay` binary on `PATH`, otherwise
  `npx --yes pushtodisplay@0.1.19`. For reliable final lines (`Interrupt`,
  `SessionEnd`), install it globally: `npm i -g pushtodisplay`.
- An authenticated Push To Display account (`pushtodisplay auth login
  --device-code`).

## Commands

Codex 0.167.x plugins bundle skills rather than shell-backed slash commands.
The plugin ships four action skills plus a deterministic script:

| Skill | Action |
| --- | --- |
| `pushtodisplay:pushtodisplay-login` | OAuth device-code login. |
| `pushtodisplay:pushtodisplay-status` | Show auth and resolved configuration. |
| `pushtodisplay:pushtodisplay-test` | Send a test entry. |
| `pushtodisplay:pushtodisplay-clear` | Write a `log cleared` entry. |

The same actions are available without the model:

```bash
node scripts/pushtodisplay.mjs login
node scripts/pushtodisplay.mjs status
node scripts/pushtodisplay.mjs test
node scripts/pushtodisplay.mjs clear
```

`commands/*.md` is a legacy compatibility surface for clients that migrate
legacy plugin commands; the portable plugin manifest does not expose them.

## Configuration (environment variables)

| Variable | Default | Meaning |
| --- | --- | --- |
| `PUSHTODISPLAY_BOARD_ID` | default board | Send to a specific board. |
| `PUSHTODISPLAY_PANEL` | `1` | Which panel (1–4) this agent writes to. |
| `PUSHTODISPLAY_LABEL` | cwd basename | Agent name in the first field of every line. |
| `PUSHTODISPLAY_STEPS` | on | `0` skips per-tool entries. |
| `PUSHTODISPLAY_DISABLED` | off | `1` disables the plugin entirely. |

For parallel agents, give each one its own panel and label:

```bash
PUSHTODISPLAY_PANEL=1 PUSHTODISPLAY_LABEL=cicd codex
PUSHTODISPLAY_PANEL=2 PUSHTODISPLAY_LABEL=qa codex
```

## Troubleshooting

- **No lines at all** — check `/hooks`: plugin hooks must be trusted. Also
  check `PUSHTODISPLAY_DISABLED` and `PUSHTODISPLAY_LABEL`.
- **Lines stop after a while** — auth is known-bad. Updates are dropped, not
  buffered, until login; the hook re-probes every 20 seconds and login
  re-enables sending immediately.
- **CLI not found** — `npm i -g pushtodisplay`. The plugin falls back to
  `npx --yes pushtodisplay@0.1.19`, which is slower and may exceed short final-event
  timeouts.
- **Wrong panel** — `PUSHTODISPLAY_PANEL` must be 1–4; anything else falls back
  to 1. `/pushtodisplay-status` (or the helper's `status`) shows the resolved
  values.
- **Too noisy** — `PUSHTODISPLAY_STEPS=0` posts milestones only.

## Reference

- Board and account: [pushtodisplay.com](https://pushtodisplay.com)
- Hook docs: https://developers.openai.com/codex/hooks
- Plugin docs: https://developers.openai.com/plugins/build/plugins
- Push To Display is a product of Goban Source, LLC.
