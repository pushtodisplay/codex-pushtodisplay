---
name: setup
description: Set up codex-pushtodisplay after installation — trust hooks, log in if needed, send a test entry, and mark this Codex integration as set up.
---

# Set up Push To Display for Codex

Help the user get from “plugin installed” to “my board is updating.” Do not
change their board or panel unless they ask.

## 1. Trust the bundled hooks

Codex does not run plugin hooks until the user reviews them. Tell the user to:

1. Open `/hooks` in the Codex CLI (or **Settings > Hooks** in the desktop app).
2. Review the `pushtodisplay` hook source.
3. Trust the current definition.

Hook trust is recorded against the hook definition and plugin content hash, so
a plugin update can prompt for review again.

## 2. Run the plugin setup

Use the helper that ships inside the plugin:

```bash
SCRIPT="${PLUGIN_ROOT:+$PLUGIN_ROOT/scripts/pushtodisplay.mjs}"
if [ ! -f "$SCRIPT" ]; then
  SCRIPT="$(find "${CODEX_HOME:-$HOME/.codex}/plugins" -path '*pushtodisplay*/scripts/pushtodisplay.mjs' -print 2>/dev/null | sort | tail -n 1)"
fi
if [ -z "$SCRIPT" ]; then
  echo "codex-pushtodisplay helper not found; reinstall the plugin." >&2
  exit 1
fi
node "$SCRIPT" setup
```

The helper:

- logs in with device-code OAuth if needed;
- sends one test entry to the configured board/panel;
- writes a Codex-specific setup marker only after that test succeeds.

If the user already logged in through opencode, pi, or another integration, the
helper reuses the shared credential but still sends a Codex test and writes the
marker. Without the marker, this plugin stays silent.

Open the URL for the user when possible. Never ask them to paste a token into
the chat.

## 3. Confirm

Run the status helper and summarize the result:

```bash
node "$SCRIPT" status
```

A successful setup shows `Auth: logged in` and `Setup: complete`. The test entry
should read `<label> link OK, panel N OK HH:MM` on the board.

## Configuration (only if the user asks)

| Variable | Default | Meaning |
| --- | --- | --- |
| `PUSHTODISPLAY_BOARD_ID` | default board | Board ID to send to. |
| `PUSHTODISPLAY_PANEL` | `1` | Panel 1–4. |
| `PUSHTODISPLAY_LABEL` | cwd basename | Agent name on every line. |
| `PUSHTODISPLAY_STEPS` | on | `0` posts milestones only. |
| `PUSHTODISPLAY_DISABLED` | off | `1` disables the plugin. |

Report problems plainly: untrusted hooks, a logged-out account, an incomplete
setup marker, or a board/panel mismatch. Do not tell the user to install a
separate `pushtodisplay` CLI; the plugin bundles it.
