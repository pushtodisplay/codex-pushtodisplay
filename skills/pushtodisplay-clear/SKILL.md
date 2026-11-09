---
name: pushtodisplay-clear
description: Write a `log cleared` entry to the configured Push To Display panel.
---

# Push To Display clear

Write one `log cleared` entry to the configured panel using the helper that
ships inside the plugin:

```bash
SCRIPT="${PLUGIN_ROOT:+$PLUGIN_ROOT/scripts/pushtodisplay.mjs}"
if [ ! -f "$SCRIPT" ]; then
  SCRIPT="$(find "${CODEX_HOME:-$HOME/.codex}/plugins" -path '*pushtodisplay*/scripts/pushtodisplay.mjs' -print 2>/dev/null | sort | tail -n 1)"
fi
if [ -z "$SCRIPT" ]; then
  echo "codex-pushtodisplay helper not found; reinstall the plugin." >&2
  exit 1
fi
node "$SCRIPT" clear
```

The panel is a scrolling history; clearing writes a marker and does not delete
past entries. The helper's output is already visible; do not repeat it — reply
with at most one short line.
