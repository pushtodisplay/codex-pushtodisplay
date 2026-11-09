---
description: Send a test entry to the configured Push To Display board and panel.
---

# Push To Display wiring test

Send one `link OK` entry to the configured panel.

```bash
SCRIPT="${PLUGIN_ROOT:+$PLUGIN_ROOT/scripts/pushtodisplay.mjs}"
if [ ! -f "$SCRIPT" ]; then
  SCRIPT="$(find "${CODEX_HOME:-$HOME/.codex}/plugins" -path '*pushtodisplay*/scripts/pushtodisplay.mjs' -print 2>/dev/null | sort | tail -n 1)"
fi
if [ -z "$SCRIPT" ]; then
  echo "codex-pushtodisplay helper not found; reinstall the plugin." >&2
  exit 1
fi
node "$SCRIPT" test
```

If the command reports that the user is not authenticated or setup is
incomplete, tell them to run `setup`. The plugin bundles its own CLI; do not
suggest installing a separate one.
