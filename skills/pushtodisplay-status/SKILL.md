---
name: pushtodisplay-status
description: Show whether codex-pushtodisplay is authenticated, set up, and where it is configured to send.
---

# Push To Display status

Report the resolved configuration, auth, and setup state without changing
anything. Use the helper that ships inside the plugin:

```bash
SCRIPT="${PLUGIN_ROOT:+$PLUGIN_ROOT/scripts/pushtodisplay.mjs}"
if [ ! -f "$SCRIPT" ]; then
  SCRIPT="$(find "${CODEX_HOME:-$HOME/.codex}/plugins" -path '*pushtodisplay*/scripts/pushtodisplay.mjs' -print 2>/dev/null | sort | tail -n 1)"
fi
if [ -z "$SCRIPT" ]; then
  echo "codex-pushtodisplay helper not found; reinstall the plugin." >&2
  exit 1
fi
node "$SCRIPT" status
```

Run the helper exactly once and relay its output verbatim. Do not run it a
second time and do not add a separate summary; the helper already prints the
board, panel, label, auth, and setup lines. If auth or setup is incomplete, tell
the user to run the `setup` skill.

The plugin bundles its own CLI; do not suggest installing a separate one.
