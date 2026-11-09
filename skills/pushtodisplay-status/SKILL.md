---
name: pushtodisplay-status
description: Show whether codex-pushtodisplay is authenticated and where it is configured to send.
---

# Push To Display status

Report the resolved configuration and auth state without changing anything.

Configuration comes from the environment:

```bash
env | grep '^PUSHTODISPLAY_' | sort
```

Auth comes from the `pushtodisplay` CLI:

```bash
if command -v pushtodisplay >/dev/null 2>&1; then
  pushtodisplay auth status --json
else
  npx --yes pushtodisplay@0.1.19 auth status --json
fi
```

If the installed plugin's helper is easy to find, it prints both in one call:

```bash
SCRIPT="$(find "${CODEX_HOME:-$HOME/.codex}/plugins" -path '*pushtodisplay*/scripts/pushtodisplay.mjs' -print -quit 2>/dev/null)"
[ -n "$SCRIPT" ] && node "$SCRIPT" status
```

Summarize in four short lines:

- **Auth**: logged in or not; if not, tell the user to run the
  `pushtodisplay-login` skill.
- **Board**: `PUSHTODISPLAY_BOARD_ID` or "default board".
- **Panel**: `PUSHTODISPLAY_PANEL` (1–4, default 1).
- **Label**: `PUSHTODISPLAY_LABEL` or the workspace folder basename.
