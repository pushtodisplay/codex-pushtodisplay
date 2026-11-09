# Distribution

The normal user install path is the **repository marketplace**. npm and local
checkout installs are alternative/developer paths, not the quick start.

The **public OpenAI Plugins Directory is not available today**. The public plugin directory
rejects plugin ZIPs that contain lifecycle hooks, and this plugin is hooks-based.
Do not submit it.

## Repository marketplace install

Requirements: Codex CLI 0.167.x, Node.js 18+, and a Push To Display account.

```bash
codex plugin marketplace add pushtodisplay/codex-pushtodisplay
codex plugin add pushtodisplay@pushtodisplay
```

Then:

1. Open `/hooks` in the Codex CLI (or **Settings > Hooks** in the desktop app).
2. Review the `pushtodisplay` hook source.
3. Trust the current definition.
4. Run the setup helper from a normal terminal (same user account):

   ```bash
   SCRIPT="$(find "${CODEX_HOME:-$HOME/.codex}/plugins" -path '*pushtodisplay*/scripts/pushtodisplay.mjs' -print 2>/dev/null | sort | tail -n 1)"
   if [ -z "$SCRIPT" ]; then
     echo "codex-pushtodisplay plugin not found; reinstall it." >&2
     exit 1
   fi
   node "$SCRIPT" setup
   ```

The helper logs in if needed, sends a test entry, and writes a Codex-specific
setup marker. Installation alone sends nothing. A shared login from opencode, pi,
or another integration does not enable this plugin until Codex setup completes.

Setup needs host credentials and network, so a model shell inside Codex's
sandbox is not a reliable place to run it. If a one-time escalated command is
available, approve that once instead; if it is denied, use the terminal. `status`
inside Codex may say `Auth: not checked here (sandbox/network/keychain)`; that is
not a logout, and the setup marker still governs whether hooks run.

Inspect the install if needed:

```bash
codex plugin marketplace list
codex plugin list --json
```

## npm install (alternative)

The npm package is `codex-pushtodisplay`. It vendors the pinned `pushtodisplay`
CLI, so Codex's npm source (`npm pack --ignore-scripts`) carries the CLI with the
plugin. No separate global CLI install is required.

Add a personal marketplace entry with an npm source:

```bash
mkdir -p ~/.agents/plugins
cat > ~/.agents/plugins/marketplace.json <<'JSON'
{
  "name": "pushtodisplay-npm",
  "interface": { "displayName": "Push To Display (npm)" },
  "plugins": [
    {
      "name": "pushtodisplay",
      "source": {
        "source": "npm",
        "package": "codex-pushtodisplay",
        "version": "0.2.0"
      },
      "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
      "category": "Productivity"
    }
  ]
}
JSON
codex plugin add pushtodisplay@pushtodisplay-npm
```

If `~/.agents/plugins/marketplace.json` already exists, merge the plugin entry
into its `plugins` array instead of replacing the file. Codex reads the personal
marketplace automatically.

After installing, trust the hooks and run the host-side setup helper exactly as
in the repository-marketplace path.

To verify the package directly, install it in a temporary directory:

```bash
tmp="$(mktemp -d)"
cd "$tmp"
npm init -y >/dev/null
npm install codex-pushtodisplay@0.2.0
test -f node_modules/codex-pushtodisplay/vendor/pushtodisplay/dist/cli.js
echo "vendored CLI present"
```

## Local checkout (development)

```bash
git clone https://github.com/pushtodisplay/codex-pushtodisplay.git
cd codex-pushtodisplay
npm ci
codex plugin marketplace add "$PWD"
codex plugin add pushtodisplay@pushtodisplay
```

`npm ci` is for development and tests. The plugin already vendors the CLI it
needs at runtime.

## Requirements and CLI

- **Codex CLI 0.167.x** — plugin-bundled lifecycle hooks.
- **Node.js 18+** — the hook is plain ESM with no build step.
- **A Push To Display account** — the setup skill opens the device-code login.
- **No separate CLI install** — the plugin bundles the CLI it needs.

The resolver still supports an installed `node_modules/pushtodisplay`, a binary
on `PATH`, and a pinned `npx` fallback for unusual or broken installs. These are
internal resilience paths, not user instructions.

## Codex 0.167 manifest note

Codex 0.167 treats a root `plugin.json` containing `$schema` as a portable Agent
Plugins package and does not load bundled lifecycle hooks in that mode. The root
manifest therefore omits `$schema`, and the `.codex-plugin/plugin.json`
compatibility manifest carries the hooks, interface, and onboarding skill.
Changing this shape can silently disable hook discovery; the test suite guards
it.

## Public directory blocker

The official directory submission page is
<https://platform.openai.com/plugins> and the rules are at
<https://developers.openai.com/plugins/deploy/submission>. The relevant rule is
explicit: plugin ZIP packages containing lifecycle hooks cannot currently be
submitted, and plugins that depend on lifecycle hooks must be distributed so
users can install them manually in Codex desktop. Do not create a directory
submission for this plugin.
