---
name: pushtodisplay-login
description: Re-authenticate Push To Display (OAuth device-code) after an expired or revoked login.
---

# Push To Display login

Use this after setup is already complete and the account needs to log in again.
On a fresh install, run the `setup` skill instead — login alone does not mark a
new Codex integration as set up.

Login is a **host-side action**, like setup. It needs the OS credential store
and the Push To Display identity host. Prefer a normal terminal with the same
user account that runs Codex:

```bash
SCRIPT="$(find "${CODEX_HOME:-$HOME/.codex}/plugins" -path '*pushtodisplay*/scripts/pushtodisplay.mjs' -print 2>/dev/null | sort | tail -n 1)"
if [ -z "$SCRIPT" ]; then
  echo "codex-pushtodisplay plugin not found; reinstall it." >&2
  exit 1
fi
node "$SCRIPT" login
```

If the client offers a one-time escalated command, the user may instead approve
that once so the helper runs outside the sandbox. Use
`sandbox_permissions: require_escalated` with the justification:

> Push To Display login needs host network access to idp.pushtodisplay.com.

If escalation is denied or unavailable, give the normal-terminal command once.
Do not retry escalation and do not start a sandboxed login repeatedly.

The helper uses the CLI bundled inside the plugin. Show the user the printed URL
and code when the helper is interactive. Open the URL when possible. Never ask
the user to paste credentials or tokens into the chat.

Do not run `status` afterwards as a verification step inside the same sandbox:
it cannot check host auth and will report `Auth: not checked here`. That is not
a failed login. The helper's own final line is the outcome; do not repeat it.
Reply with at most one short line.
