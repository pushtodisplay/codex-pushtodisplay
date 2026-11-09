---
name: pushtodisplay-test
description: Send a test entry to the configured Push To Display board and panel.
---

# Push To Display wiring test

Send one `link OK` entry to the configured panel. Prefer the bundled helper if
you can find it; otherwise use the CLI directly.

```bash
SCRIPT="$(find "${CODEX_HOME:-$HOME/.codex}/plugins" -path '*pushtodisplay*/scripts/pushtodisplay.mjs' -print -quit 2>/dev/null)"
if [ -n "$SCRIPT" ] && [ -f "$SCRIPT" ]; then
  node "$SCRIPT" test
else
  if command -v pushtodisplay >/dev/null 2>&1; then
    pushtodisplay send -p "${PUSHTODISPLAY_PANEL:-1}" "link OK, test"
  else
    npx --yes pushtodisplay@0.1.19 send -p "${PUSHTODISPLAY_PANEL:-1}" "link OK, test"
  fi
fi
```

If the command reports that you are not authenticated, tell the user to run the
`pushtodisplay-login` skill. If it reports that the CLI is missing, suggest
`npm i -g pushtodisplay`.
