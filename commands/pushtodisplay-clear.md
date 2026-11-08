---
description: Write a `log cleared` entry to the configured Push To Display panel.
---

# Push To Display clear

Write one `log cleared` entry to the configured panel. Prefer the bundled helper
if you can find it; otherwise use the CLI directly.

```bash
SCRIPT="${PLUGIN_ROOT:-}"
if [ -z "$SCRIPT" ]; then
  SCRIPT="$(find "${CODEX_HOME:-$HOME/.codex}/plugins" -path '*pushtodisplay*/scripts/pushtodisplay.mjs' -print -quit 2>/dev/null)"
fi
if [ -n "$SCRIPT" ] && [ -f "$SCRIPT" ]; then
  node "$SCRIPT" clear
else
  if command -v pushtodisplay >/dev/null 2>&1; then
    pushtodisplay send -p "${PUSHTODISPLAY_PANEL:-1}" "log cleared"
  else
    npx --yes pushtodisplay send -p "${PUSHTODISPLAY_PANEL:-1}" "log cleared"
  fi
fi
```

The panel is a scrolling history; clearing writes a marker and does not delete
past entries.
