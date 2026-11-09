---
name: pushtodisplay-status
description: Show whether codex-pushtodisplay is set up and where it sends; distinguish a sandboxed auth probe from a real logout.
---

# Push To Display status

Report the resolved configuration, setup marker, and auth state without changing
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
print the status block again and do not add a separate summary. Reply with at
most one short sentence.

Read the `Setup` and `Auth` lines together:

- `Setup: complete` + `Auth: logged in`:
  “Push To Display is set up and authenticated.”
- `Setup: complete` + `Auth: not checked here`:
  “Setup is complete; auth could not be checked in this sandbox.”
- `Setup: not complete`:
  “Push To Display setup is not complete; run `$pushtodisplay:setup` from a
  normal terminal.”

Important:

- `Auth: not checked here (sandbox/network/keychain)` is **not** a login
  failure. The status helper runs inside Codex's sandbox and cannot read the
  host credential store or network. Hooks run on the host and check auth
  themselves.
- Never turn an unavailable probe into “not logged in”, and never recommend a
  login just because status could not check.
- Do not suggest installing a separate `pushtodisplay` CLI. The plugin bundles
  the CLI it needs.
