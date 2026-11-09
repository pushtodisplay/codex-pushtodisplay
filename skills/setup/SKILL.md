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

Run the helper with **escalated permissions** so it can reach the Push To Display
identity and API hosts. Use `sandbox_permissions: require_escalated` with the
justification:

> Push To Display setup needs network access to idp.pushtodisplay.com and api.pushtodisplay.com.

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

Codex should show one approval prompt. Tell the user to approve it once. Do not
send them to a separate terminal unless Codex rejects escalation or the user
denies it.

The helper:

- logs in with device-code OAuth if needed;
- sends one test entry to the configured board/panel;
- writes a Codex-specific setup marker only after that test succeeds.

If the user already logged in through opencode, pi, or another integration, the
helper reuses the shared credential but still sends a Codex test and writes the
marker. Without the marker, this plugin stays silent.

Open the URL for the user when possible. Never ask them to paste a token into
the chat.

If the helper reports `fetch failed`, `getaddrinfo`, or a DNS error, it ran
without network. Retry it with `sandbox_permissions: require_escalated`. Only if
escalation is unavailable or denied should the user run the same helper from a
normal terminal with network access; that also writes the shared setup marker.

If setup is blocked, explain the blocker once and give one next action. Do not
repeat the same explanation.

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
