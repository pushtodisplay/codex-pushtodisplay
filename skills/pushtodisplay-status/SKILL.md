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

Run the helper exactly once. Its output is already shown to the user, so do not
print the status block again and do not add a separate summary. Reply with one
short sentence:

- If `Auth` is “logged in” and `Setup` is “complete”: “Push To Display is set up
  and authenticated.”
- Otherwise: “Push To Display is not set up yet; run `$pushtodisplay:setup`.”

The plugin bundles its own CLI; do not suggest installing a separate one.
