---
description: Log in to Push To Display (OAuth device-code) so Codex activity can be mirrored to your board.
---

# Push To Display login

Use this after setup is complete and the account needs to log in again. On a
fresh install, run the `setup` skill instead.

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

Show the printed URL and code. Open the URL when possible. Never ask the user to
paste credentials or tokens into the chat. Verify with:

```bash
node "$SCRIPT" status
```

The plugin bundles its own CLI; do not install a separate one.
