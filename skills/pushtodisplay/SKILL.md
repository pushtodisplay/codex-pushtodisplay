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

`codex-pushtodisplay` is a Codex plugin (hooks + skills) that mirrors agent
activity onto a **Push To Display** board (https://pushtodisplay.com) in real
time. A panel is a **shared scrolling log**: one entry per event, newest at the
top, and every entry has the same shape:

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

Then:

1. Open `/hooks` and trust the bundled `pushtodisplay` hooks. A plugin update
   that changes the hook script requires a new review.
2. Run the `setup` skill. It logs in if needed, sends a test entry, and writes a
   Codex-specific setup marker.

Installation alone sends nothing. A login from opencode, pi, or another
integration on the same machine does not enable this plugin; the setup marker is
required.

## Requirements

- Codex CLI 0.167.x with plugin-bundled lifecycle hooks.
- Node.js 18 or newer (plain ESM; no build step).
- A Push To Display account.
- No separate `pushtodisplay` CLI install. The plugin bundles the CLI it needs.

## Skills

| Skill | Action |
| --- | --- |
| `pushtodisplay:setup` | Log in if needed, send a test entry, and mark this Codex integration as set up. |
| `pushtodisplay:pushtodisplay-status` | Show auth, setup, board, panel, and label. |
| `pushtodisplay:pushtodisplay-test` | Send a test entry. |
| `pushtodisplay:pushtodisplay-clear` | Write a `log cleared` entry. |
| `pushtodisplay:pushtodisplay-login` | Re-authenticate after an expired or revoked login. |

`setup` is the supported entry point. The other skills are optional diagnostics
or re-authentication helpers.

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

- **No lines at all** — check `/hooks`: plugin hooks must be trusted. Check
  `PUSHTODISPLAY_DISABLED` and run the `setup` skill. A fresh install stays
  silent until setup completes.
- **Lines stop after a while** — auth is known-bad. Run the `setup` skill (or
  the `pushtodisplay-login` skill if setup is already complete). Updates are
  dropped, not buffered, until login; the hook re-probes every 20 seconds.
- **Helper not found** — reinstall the plugin. The plugin bundles its own CLI;
  do not install a separate one.
- **Wrong panel** — `PUSHTODISPLAY_PANEL` must be 1–4; anything else falls back
  to 1. The status skill shows the resolved values.
- **Too noisy** — `PUSHTODISPLAY_STEPS=0` posts milestones only.

## Reference

- Board and account: [pushtodisplay.com](https://pushtodisplay.com)
- Hook docs: https://developers.openai.com/codex/hooks
- Plugin docs: https://developers.openai.com/plugins/build/plugins
- Push To Display is a product of Goban Source, LLC.
