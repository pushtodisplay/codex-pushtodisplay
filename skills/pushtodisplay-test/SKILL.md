---
name: pushtodisplay-test
description: Send a test entry to the configured Push To Display board and panel.
---

# Push To Display wiring test

Send one `link OK` entry to the configured panel using the helper that ships
inside the plugin:

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

The helper's output is already visible; do not repeat it. Reply with at most one
short line.

If the send fails because the helper cannot reach the credential store or
network, it is running inside Codex's sandbox. Run the same helper from a normal
terminal instead. If it reports that setup is incomplete, run
`$pushtodisplay:setup` from a normal terminal. The plugin bundles its own CLI;
do not suggest installing a separate one.
