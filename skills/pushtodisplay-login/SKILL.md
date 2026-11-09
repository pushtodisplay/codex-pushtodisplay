---
name: pushtodisplay-login
description: Re-authenticate Push To Display (OAuth device-code) after an expired or revoked login.
---

# Push To Display login

Use this after setup is already complete and the account needs to log in again.
On a fresh install, run the `setup` skill instead — login alone does not mark a
new Codex integration as set up.

```bash
SCRIPT="${PLUGIN_ROOT:+$PLUGIN_ROOT/scripts/pushtodisplay.mjs}"
if [ ! -f "$SCRIPT" ]; then
  SCRIPT="$(find "${CODEX_HOME:-$HOME/.codex}/plugins" -path '*pushtodisplay*/scripts/pushtodisplay.mjs' -print 2>/dev/null | sort | tail -n 1)"
fi
if [ -z "$SCRIPT" ]; then
  echo "codex-pushtodisplay helper not found; reinstall the plugin." >&2
  exit 1
fi
node "$SCRIPT" login
```

The helper uses the CLI bundled inside the plugin. Show the user the printed URL
and code. Open the URL when possible. Never ask the user to paste credentials or
tokens into the chat.

Verify with:

```bash
node "$SCRIPT" status
```

Report the auth and setup state in one sentence. The plugin re-probes auth on its
own, so no restart is needed.
