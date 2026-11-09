# Distribution

`codex-pushtodisplay` ships through two channels:

1. **Repo marketplace** — the recommended path for Codex CLI users who want the
   plugin and its hooks from this repository.
2. **npm** — the package `codex-pushtodisplay`, consumed through a marketplace
   entry with `"source": "npm"`.

The official OpenAI Plugins Directory is **not currently an available path** for
this plugin, because it depends on lifecycle hooks. The details are below.

## Repo marketplace

The marketplace catalog is `.agents/plugins/marketplace.json`. It exposes one
plugin whose local source is the repository root:

```json
{
  "name": "pushtodisplay",
  "plugins": [
    {
      "name": "pushtodisplay",
      "source": { "source": "local", "path": "./" },
      "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
      "category": "Developer Tools"
    }
  ]
}
```

Install from GitHub:

```bash
codex plugin marketplace add pushtodisplay/codex-pushtodisplay
codex plugin add pushtodisplay@pushtodisplay
```

Install from a local checkout:

```bash
codex plugin marketplace add /absolute/path/to/codex-pushtodisplay
codex plugin add pushtodisplay@pushtodisplay
```

Codex copies the plugin into
`$CODEX_HOME/plugins/cache/pushtodisplay/pushtodisplay/<version>/` (Codex
0.167.0 used the manifest version, `0.1.0`). The marketplace root is the
repository root, so the entry's path is `./`.

Then review and trust the hooks in `/hooks`; Codex skips untrusted non-managed
hooks. In the desktop app, use **Review hooks** or **Settings > Hooks**.

Verify:

```bash
codex plugin list --json
```

## npm

The package is `codex-pushtodisplay`. Codex consumes it through an npm-backed
marketplace entry:

```json
{
  "name": "pushtodisplay-npm",
  "interface": { "displayName": "Push To Display (npm)" },
  "plugins": [
    {
      "name": "pushtodisplay",
      "source": {
        "source": "npm",
        "package": "codex-pushtodisplay",
        "version": "^0.1.0"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Developer Tools"
    }
  ]
}
```

Save it under a marketplace root, for example
`~/codex-pushtodisplay-marketplace/.agents/plugins/marketplace.json`, then:

```bash
codex plugin marketplace add ~/codex-pushtodisplay-marketplace
codex plugin add pushtodisplay@pushtodisplay-npm
```

Codex downloads npm packages **without running lifecycle scripts**. The plugin
resolves the CLI at runtime:

1. `PUSHTODISPLAY_CLI`
2. a bundled `node_modules/pushtodisplay` (development checkout)
3. `pushtodisplay` on `PATH`
4. `npx --yes pushtodisplay`

For a predictable install without `npx`, install the CLI once with
`npm install -g pushtodisplay`.

## Why the official directory is blocked

OpenAI's universal Plugins Directory is shared by ChatGPT and Codex. Submission
is at <https://platform.openai.com/plugins>; the process is documented at
<https://developers.openai.com/plugins/deploy/submission>.

The current submission documentation says:

> Plugin ZIP packages containing app references (`apps` / `.app.json`) or
> lifecycle hooks cannot currently be submitted.

It also says:

> Lifecycle hooks are supported for plugins installed manually in Codex desktop.
> Plugins containing lifecycle hooks aren't eligible for the public plugin
> directory.

This plugin is hooks-based: its product is observing `SessionStart`,
`UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Stop`,
`SubagentStart`, `SubagentStop`, `Interrupt`, `PostModelRequest`, and
`SessionEnd`. Removing the hooks would remove the mirror.

Therefore:

- the official directory is **not** an available distribution path today;
- this repository does **not** claim a listing;
- no submission was attempted, and none should be attempted while the package
  contains hooks.

### What would make the directory possible later

1. **OpenAI enables lifecycle hooks in public submissions.** The existing
   package can then go through the normal ZIP validation and review path. This
   is the cleanest outcome and requires no product change.
2. **A skills-only or MCP-only variant is accepted.** A skills-only package can
   be submitted, but it cannot passively see Codex lifecycle events; it would be
   a manual command surface. An MCP server would need a stable public HTTPS
   endpoint and the portal's connection/domain-verification flow, and would only
   record actions the model explicitly sends to it. Either is a narrower,
   different product.
3. **A desktop-only submission path is opened.** The submission guide already
   distinguishes manual desktop installs. If those become directory-eligible,
   this package can be prepared for review.

Any future submission also needs a verified publisher identity, listing copy,
icons, privacy/support/terms URLs, review cases, and a release ZIP without
unsupported components.

## Security

Hooks execute local code on every session, prompt, and tool call. Review
`hooks/hooks.json` and `hooks/hook.mjs` before trusting them. The plugin sends
prompts, tool descriptions, and result summaries to the configured board; do not
put secrets in prompts or shell commands. Credentials belong to the
`pushtodisplay` CLI and its keychain.
