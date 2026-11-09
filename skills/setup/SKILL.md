---
name: setup
description: Set up codex-pushtodisplay after installation — host-side login if needed, a test entry, and a Codex setup marker.
---

# Set up Push To Display for Codex

Setup is a **host-side action**. It needs the OS credential store and the
Push To Display identity/API network. A shell command started by the model runs
inside Codex's sandbox, where those may be unavailable. That is an environment
problem, not a logout.

## 1. Run setup where the host credentials live

Prefer a normal terminal with the same user account that runs Codex:

```bash
SCRIPT="$(find "${CODEX_HOME:-$HOME/.codex}/plugins" -path '*pushtodisplay*/scripts/pushtodisplay.mjs' -print 2>/dev/null | sort | tail -n 1)"
if [ -z "$SCRIPT" ]; then
  echo "codex-pushtodisplay plugin not found; reinstall it." >&2
  exit 1
fi
node "$SCRIPT" setup
```

If the client offers a one-time escalated command, the user may instead approve
that once so the same helper runs outside the sandbox. Use
`sandbox_permissions: require_escalated` with the justification:

> Push To Display setup needs host network access to idp.pushtodisplay.com and api.pushtodisplay.com.

If escalation is denied or unavailable, give the normal-terminal command once.
Do not retry escalation and do not try a sandboxed login repeatedly.

The helper:

- logs in with the device-code flow if needed;
- sends one test entry to the configured board/panel;
- writes the Codex-specific setup marker only after both succeed;
- prints one final outcome.

If the helper says it cannot reach the credential store or network, it ran in
the sandbox. Hand the user the normal-terminal command once. Do **not** run
`status` to "confirm" in that same sandbox; its auth probe cannot see the host
either. Do not describe this as "not logged in".

If the user already logged in through opencode, pi, or another integration, the
helper reuses the shared credential but still sends a Codex test and writes the
marker. Without the marker, this plugin stays silent.

Open the login URL for the user when possible. Never ask them to paste a token
into the chat.

## 2. Do not repeat the helper

The helper's output is already visible. Do not print the outcome, the config
block, or the recovery hint again. Reply with at most one short line.

A successful setup ends with one line like:

`Push To Display setup complete for Codex. Board: … , panel … . Test entry: …`

The test entry should appear on the board as
`<label> link OK, panel N OK HH:MM`.

## 3. Hook trust is troubleshooting only

Do not mention hook trust after a successful setup. If the board stays empty in
a later session, then check `/hooks`: if the `pushtodisplay` hooks show as
untrusted, trust them once. Hook trust is recorded against the hook definition
and plugin content hash, so a plugin update may require a new review.

## Configuration (only if the user asks)

| Variable | Default | Meaning |
| --- | --- | --- |
| `PUSHTODISPLAY_BOARD_ID` | default board | Board ID to send to. |
| `PUSHTODISPLAY_PANEL` | `1` | Panel 1–4. |
| `PUSHTODISPLAY_LABEL` | cwd basename | Agent name on every line. |
| `PUSHTODISPLAY_STEPS` | on | `0` posts milestones only. |
| `PUSHTODISPLAY_DISABLED` | off | `1` disables the plugin. |

The plugin bundles its own CLI. Do not tell the user to install a separate
`pushtodisplay` CLI.
