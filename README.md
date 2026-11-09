# codex-pushtodisplay

Mirror Codex CLI activity onto a **Push To Display** board as a shared,
human-readable log.

Each line is one event, written as a sentence:

```
release running npm test RUN 11:04
release running npm test OK 11:05
qa Allow Bash: git push origin main NEEDS 11:07
release Pinned the clock so the release test passes. DONE 11:08
```

The agent name leads, so several sessions can share one panel. Messages are
rate-limited, deduplicated, and queued on disk so a busy tool loop cannot flood
the board or reorder the trail.

## Requirements

- Codex CLI **0.167.0** or newer (tested with 0.167.0).
- Node.js **18** or newer on `PATH`.
- A Push To Display account and board.
- The `pushtodisplay` CLI. You normally do not install it globally: the plugin
  uses its bundled dependency when present, then `pushtodisplay` on `PATH`, then
  `npx --yes pushtodisplay`.

## Install from this repo's marketplace

The marketplace is at `.agents/plugins/marketplace.json`. Add this repository as
a marketplace, then install the plugin:

```bash
codex plugin marketplace add pushtodisplay/codex-pushtodisplay
codex plugin add pushtodisplay@pushtodisplay
```

From a local checkout, point Codex at the checkout instead:

```bash
codex plugin marketplace add /absolute/path/to/codex-pushtodisplay
codex plugin add pushtodisplay@pushtodisplay
```

Then **review and trust the hooks**. Codex skips untrusted non-managed hooks:

1. Start Codex in a project.
2. Run `/hooks`.
3. Review the `pushtodisplay` hooks and trust them.

For non-interactive automation that already vets the source, Codex accepts
`codex exec --dangerously-bypass-hook-trust ...`. Do not use that flag casually.

Confirm the install:

```bash
codex plugin list --json
```

## Install from npm

The package is `codex-pushtodisplay`. Codex installs plugins from marketplaces,
including npm-backed entries. Create a marketplace file that points at the npm
package, then add that marketplace root:

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

Save it as `~/codex-pushtodisplay-marketplace/.agents/plugins/marketplace.json`,
then:

```bash
codex plugin marketplace add ~/codex-pushtodisplay-marketplace
codex plugin add pushtodisplay@pushtodisplay-npm
```

Codex downloads npm packages **without running lifecycle scripts**. The plugin
therefore does not rely on a postinstall step: it falls back to `npx` when the
bundled dependency is not present. If you prefer a local CLI, install it first:

```bash
npm install -g pushtodisplay
```

See [docs/distribution.md](docs/distribution.md) for the full distribution story
and the official Plugins Directory blocker.

## Authenticate

Use the bundled skill:

```
$pushtodisplay-login
```

or run the CLI directly:

```bash
pushtodisplay auth login --device-code
```

The login flow opens a browser and prints a device code. Credentials are stored
by the `pushtodisplay` CLI in the OS keychain, with a `0600` fallback file when
no keychain is available. The plugin never stores or prints the access token.

## Skills

Codex skills are invoked with `$` or via `/skills`:

| Skill | What it does |
| --- | --- |
| `$pushtodisplay-login` | OAuth device-code login |
| `$pushtodisplay-status` | Auth, CLI, board, panel, label, and cache status |
| `$pushtodisplay-test` | Send one test entry |
| `$pushtodisplay-clear` | Write a `log cleared` marker (does not delete history) |

Each skill runs `scripts/command.mjs`, which resolves the CLI the same way the
hooks do.

## What gets mirrored

| Codex event | Board line |
| --- | --- |
| `SessionStart` | `session opened` (skipped for `source: "compact"`) |
| `UserPromptSubmit` | The prompt, shortened to one sentence |
| `PreToolUse` | Tool start, e.g. `running npm test` |
| `PostToolUse` | Tool result, `OK` or `FAIL` (covers non-zero exits) |
| `PermissionRequest` | `Allow Bash: git push` with `NEEDS` |
| `Stop` | The last assistant message with `DONE` |
| `PostModelRequest` | A `FAIL` line for failed model attempts |
| `SessionEnd` | `session closed` |
| `SubagentStart` | `delegating to <type>` |
| `SubagentStop` | `subagent <type> finished` |
| `Interrupt` | `interrupted before it finished` |

Codex has no `StopFailure` or `PostToolUseFailure` events. `PostToolUse` fires
for failed shell commands, and `PostModelRequest` carries failed model attempts.

## Configuration

All settings are environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PUSHTODISPLAY_BOARD_ID` | default board | Board ID to write to |
| `PUSHTODISPLAY_PANEL` | `1` | Panel 1–4 |
| `PUSHTODISPLAY_LABEL` | cwd basename | Agent name shown on every line |
| `PUSHTODISPLAY_DISABLED` | unset | Set to `1` to disable all sending |
| `PUSHTODISPLAY_STEPS` | on | Set to `0` for milestones only (no tool/subagent lines) |
| `PUSHTODISPLAY_CLI` | auto | Explicit path to the `pushtodisplay` executable |
| `PUSHTODISPLAY_CACHE_DIR` | `~/.cache/pushtodisplay/codex` | Queue/auth state directory |
| `PUSHTODISPLAY_MIN_INTERVAL_MS` | `1200` | Minimum gap between sends |

Per-session examples:

```bash
PUSHTODISPLAY_LABEL=release PUSHTODISPLAY_PANEL=2 codex
```

## How it works

Codex runs a command hook as a separate process for each event. `hooks/hook.mjs`
writes the event's message into a per-session queue under the cache directory,
then a detached drainer sends queued messages in order through the
`pushtodisplay` CLI. `Stop`, `SessionEnd`, and `Interrupt` flush synchronously
within their Codex timeouts.

The queue is bounded. Every message is one event, sends are spaced at 1.2 s, and
consecutive duplicates are suppressed. A failed send is dropped so a temporary
network problem cannot stall the trail forever.

## Verify

```bash
npm test          # node --test
npm run typecheck # tsc --noEmit (JSDoc-checked JavaScript)
npm run lint      # eslint
npm run check     # all three
```

To test without a board, point `PUSHTODISPLAY_CLI` at a local script that
records `send` argv (see `fixtures/fake-cli.mjs`).

## Security

- Hooks execute a local Node script on every session, prompt, and tool call.
  **Review `hooks/hook.mjs` and `hooks/hooks.json` before trusting them.**
- The plugin sends session metadata, prompts, tool names/arguments, and
  assistant/result summaries to your configured Push To Display board. Do not
  put secrets in prompts or shell commands.
- Credentials are handled by the `pushtodisplay` CLI and its keychain. The
  plugin stores only a coarse auth status cache (`ok`/`bad` plus a timestamp).
- Queue and auth files are created with `0600` permissions under a `0700`
  directory. Hook commands are local; no remote code is executed.
- This plugin is not in the official OpenAI Plugins Directory. It is distributed
  through a repo marketplace and npm. See
  [docs/distribution.md](docs/distribution.md).

## Troubleshooting

- **Nothing appears:** run `$pushtodisplay-status`. Check that hooks are trusted
  in `/hooks`.
- **“not authenticated”:** run `$pushtodisplay-login`.
- **CLI not found:** `npm install -g pushtodisplay`, or set
  `PUSHTODISPLAY_CLI` to the executable. Marketplace installs fall back to
  `npx`.
- **Plugin installed but hooks do not run:** Codex 0.167.0 requires the
  compatibility manifest's explicit `hooks` path; this repo's
  `.codex-plugin/plugin.json` includes it. Re-run `codex plugin add` after
  updating.
- **Too noisy:** set `PUSHTODISPLAY_STEPS=0`.

## License

MIT. See [LICENSE](LICENSE).
