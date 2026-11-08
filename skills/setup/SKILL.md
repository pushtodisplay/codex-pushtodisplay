---
name: setup
description: Set up codex-pushtodisplay after installation — log in to Push To Display, verify the wiring, and explain hook trust.
---

# Set up Push To Display for Codex

Help the user get from "plugin installed" to "my board is updating" in three
steps. Do not change their board or panel unless they ask.

## 1. Trust the bundled hooks

Codex does not run plugin hooks until the user reviews them. Tell the user to:

1. Open `/hooks` in the Codex CLI (or **Settings > Hooks** in the desktop app).
2. Review the `pushtodisplay` hook source.
3. Trust the current definition.

Hook trust is recorded against the hook definition and plugin content hash, so
a plugin update can prompt for review again.

## 2. Log in

Run the device-code flow and show the URL and code:

```bash
if command -v pushtodisplay >/dev/null 2>&1; then
  pushtodisplay auth login --device-code
else
  npx --yes pushtodisplay auth login --device-code
fi
```

Open the URL for the user when possible. Never ask them to paste a token into
the chat. Verify with `pushtodisplay auth status --json` (or the `npx`
fallback).

## 3. Verify the wiring

Run the plugin helper if it is available:

```bash
SCRIPT="$(find "${CODEX_HOME:-$HOME/.codex}/plugins" -path '*pushtodisplay*/scripts/pushtodisplay.mjs' -print -quit 2>/dev/null)"
[ -n "$SCRIPT" ] && node "$SCRIPT" test
```

Otherwise send a direct test entry:

```bash
pushtodisplay send -p "${PUSHTODISPLAY_PANEL:-1}" "link OK, test"
```

A line reading `<label> link OK, panel 1 OK HH:MM` should appear on the board.

## Configuration (only if the user asks)

| Variable | Default | Meaning |
| --- | --- | --- |
| `PUSHTODISPLAY_BOARD_ID` | default board | Board ID to send to. |
| `PUSHTODISPLAY_PANEL` | `1` | Panel 1–4. |
| `PUSHTODISPLAY_LABEL` | cwd basename | Agent name on every line. |
| `PUSHTODISPLAY_STEPS` | on | `0` posts milestones only. |
| `PUSHTODISPLAY_DISABLED` | off | `1` disables the plugin. |

Report problems plainly: a missing CLI (`npm i -g pushtodisplay`), a logged-out
account, untrusted hooks, or a board/panel mismatch.
