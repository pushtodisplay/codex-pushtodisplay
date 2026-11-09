---
name: pushtodisplay-test
description: Send a test entry to the configured Push To Display board and panel. Use when the user asks to verify the board connection or check that updates arrive.
---

Run the plugin command and relay its output to the user:

```bash
node "$PLUGIN_ROOT/scripts/command.mjs" test
```

If `PLUGIN_ROOT` is not set in your shell, use the absolute path of the installed
plugin root (the directory that contains `hooks/`, `lib/`, and `scripts/`).

If it failed, mention `$pushtodisplay-status` and the troubleshooting section of
the README.
