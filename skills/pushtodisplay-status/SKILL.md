---
name: pushtodisplay-status
description: Show Push To Display authentication, board, panel, label, and CLI status for this Codex session. Use when the user asks whether Push To Display is configured or working.
---

Run the plugin command and relay its output to the user:

```bash
node "$PLUGIN_ROOT/scripts/command.mjs" status
```

If `PLUGIN_ROOT` is not set in your shell, use the absolute path of the installed
plugin root (the directory that contains `hooks/`, `lib/`, and `scripts/`).

If auth is not authenticated, tell the user to run `$pushtodisplay-login`. Do not
change any configuration.
