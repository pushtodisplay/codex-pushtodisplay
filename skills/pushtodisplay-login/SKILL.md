---
name: pushtodisplay-login
description: Authenticate Codex with Push To Display using the OAuth device-code flow. Use when the user asks to log in, or when Push To Display reports that it is not authenticated.
---

Run the plugin command and relay its output to the user:

```bash
node "$PLUGIN_ROOT/scripts/command.mjs" login
```

If `PLUGIN_ROOT` is not set in your shell, use the absolute path of the installed
plugin root (the directory that contains `hooks/`, `lib/`, and `scripts/`).

If the output shows a URL and a code, tell the user to open the URL and enter the
code in the browser. Do not run the command again and do not invent a code.
