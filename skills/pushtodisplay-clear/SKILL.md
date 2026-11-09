---
name: pushtodisplay-clear
description: Write a `log cleared` entry to the configured Push To Display panel.
---

# Push To Display clear

Write one `log cleared` entry to the configured panel. Prefer the bundled helper
if you can find it; otherwise use the CLI directly.

```bash
SCRIPT="$(find "${CODEX_HOME:-$HOME/.codex}/plugins" -path '*pushtodisplay*/scripts/pushtodisplay.mjs' -print -quit 2>/dev/null)"
if [ -n "$SCRIPT" ] && [ -f "$SCRIPT" ]; then
  node "$SCRIPT" clear
else
  if command -v pushtodisplay >/dev/null 2>&1; then
    pushtodisplay send -p "${PUSHTODISPLAY_PANEL:-1}" "log cleared"
  else
    npx --yes pushtodisplay@0.1.19 send -p "${PUSHTODISPLAY_PANEL:-1}" "log cleared"
  fi
fi
```

The panel is a scrolling history; clearing writes a marker and does not delete
past entries.
