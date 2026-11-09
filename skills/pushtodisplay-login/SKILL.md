---
name: pushtodisplay-login
description: Log in to Push To Display (OAuth device-code) so Codex activity can be mirrored to your board.
---

# Push To Display login

Run the device-code login and show the user the URL and code it prints:

```bash
if command -v pushtodisplay >/dev/null 2>&1; then
  pushtodisplay auth login --device-code
else
  npx --yes pushtodisplay@0.1.19 auth login --device-code
fi
```

If the command prints a verification URL, open it for the user when possible and
tell them to enter the printed code. Never ask the user to paste credentials or
tokens into the chat.

When the command finishes, verify with:

```bash
if command -v pushtodisplay >/dev/null 2>&1; then
  pushtodisplay auth status --json
else
  npx --yes pushtodisplay@0.1.19 auth status --json
fi
```

Report the auth state in one sentence. The plugin re-probes auth on its own, so
no restart is needed.
