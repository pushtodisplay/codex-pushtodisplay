# Distribution

`codex-pushtodisplay` is distributed through two supported paths:

1. **Repository marketplace** — Codex installs the plugin from this repository.
2. **npm** — Codex installs the published `codex-pushtodisplay` package through
   an npm marketplace source.

The **public OpenAI Plugins Directory is not an available path today**. The
submission rules reject plugin ZIPs that contain lifecycle hooks, and this
plugin is hooks-based. Do not submit it. Repository marketplace and npm are the
supported distribution paths until OpenAI accepts hook packages in the public plugin directory.

## Repository marketplace install

Requirements: Codex CLI 0.167.x, Node.js 18+, and a Push To Display account.

```bash
codex plugin marketplace add pushtodisplay/codex-pushtodisplay
codex plugin add pushtodisplay@pushtodisplay
```

For a local checkout, add it as a local marketplace. The CLI is vendored, so
`npm ci` is only needed for development and tests:

```bash
git clone https://github.com/pushtodisplay/codex-pushtodisplay.git
cd codex-pushtodisplay
codex plugin marketplace add "$PWD"
codex plugin add pushtodisplay@pushtodisplay
```

Inspect the install:

```bash
codex plugin marketplace list
codex plugin list --json
```

Then trust the bundled hooks. Codex skips non-managed plugin hooks until the
current definition is reviewed:

1. Open `/hooks` in the Codex CLI (or **Settings > Hooks** in the desktop app).
2. Review the `pushtodisplay` hook source.
3. Trust the current definition.

## npm install

The published package is `codex-pushtodisplay`. It vendors the pinned
`pushtodisplay` CLI 0.1.19, so Codex's npm source (`npm pack --ignore-scripts`)
carries the CLI with the plugin. No separate global CLI install is required.

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
        "version": "0.1.0"
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
marketplace automatically; `codex plugin marketplace list` shows what it sees.

To verify the package directly, install it in a temporary directory:

```bash
tmp="$(mktemp -d)"
cd "$tmp"
npm init -y >/dev/null
npm install codex-pushtodisplay@0.1.0
test -f node_modules/codex-pushtodisplay/vendor/pushtodisplay/dist/cli.js
echo "vendored CLI present"
```

## Requirements and CLI resolution

- **Codex CLI 0.167.x** — plugin-bundled lifecycle hooks.
- **Node.js 18+** — the hook is plain ESM with no build step.
- **The `pushtodisplay` CLI** — resolved in this order:
  1. the vendored `vendor/pushtodisplay` CLI (or an installed
     `node_modules/pushtodisplay` dependency);
  2. a `pushtodisplay` binary on `PATH`;
  3. the pinned fallback `npx --yes pushtodisplay@0.1.19`.
- **A Push To Display account**, authenticated through the CLI.

The plugin is self-contained because the pinned CLI is vendored. `npm ci` is
only needed for development and tests, not for the plugin to run. A global
install is optional; set `PUSHTODISPLAY_CLI` to an absolute path to use a
different CLI build:

```bash
npm i -g pushtodisplay@0.1.19
pushtodisplay auth login --device-code
```

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
users can install them manually in Codex desktop. That is exactly what the
repository marketplace and npm paths do. Do not create a directory submission
for this plugin.
