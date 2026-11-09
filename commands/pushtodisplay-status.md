---
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

Summarize in four short lines:

- **Auth**: logged in or not; if not, tell the user to run the
  `pushtodisplay-login` command.
- **Board**: `PUSHTODISPLAY_BOARD_ID` or "default board".
- **Panel**: `PUSHTODISPLAY_PANEL` (1–4, default 1).
- **Label**: `PUSHTODISPLAY_LABEL` or the workspace folder basename.
