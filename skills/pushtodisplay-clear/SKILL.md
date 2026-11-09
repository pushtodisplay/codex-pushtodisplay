---
name: pushtodisplay-clear
description: Write a "log cleared" marker to this session's Push To Display panel. Use when the user asks to clear or mark the board history.
---

Run the plugin command and relay its output to the user:

```bash
node "$PLUGIN_ROOT/scripts/command.mjs" clear
```

If `PLUGIN_ROOT` is not set in your shell, use the absolute path of the installed
plugin root (the directory that contains `hooks/`, `lib/`, and `scripts/`).

This writes a marker entry; it does not delete board history. Say so if the user
expects deletion.
