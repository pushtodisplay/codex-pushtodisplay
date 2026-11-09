# Publishing

The package is published to npm as `codex-pushtodisplay` from the `Publish`
workflow. The preferred path is npm Trusted Publishing (OIDC).

## Current status

`npm whoami` on the build machine fails with `ENEEDAUTH`, and no `NPM_TOKEN`
secret was available. **No publish was attempted or completed.** The steps below
are the remaining human work.

## First publish

A brand-new package cannot be configured for Trusted Publishing until it exists
on npm. Bootstrap it one of two ways.

### Option A: manual bootstrap

```bash
npm login
npm whoami
npm run check
npm pack --dry-run
npm publish --access public --provenance
```

`--provenance` may require a supported CI environment or npm's configured
provenance support. If it is unavailable for the bootstrap, publish without it
and use the workflow for subsequent releases.

### Option B: token-backed workflow

1. Create an npm granular access token with publish rights for
   `codex-pushtodisplay`.
2. Add it as the repository secret `NPM_TOKEN`.
3. Run **Actions > Publish** with `release_type: stable`, `version_bump: patch`,
   `dry_run: false`.
4. Remove the secret after Trusted Publishing is configured.

## Trusted Publishing setup

After the package exists:

1. Open the package settings on npmjs.com.
2. Add a **Trusted Publisher** → GitHub Actions:
   - Organization or user: `pushtodisplay`
   - Repository: `codex-pushtodisplay`
   - Workflow filename: `publish.yml`
   - Environment: leave empty unless you add one to the workflow.
3. Keep `permissions: id-token: write` in `.github/workflows/publish.yml`.

The workflow then publishes with `--provenance` without a long-lived token.

## Release workflow

`.github/workflows/publish.yml` is manual. Inputs:

| Input | Meaning |
| --- | --- |
| `release_type` | `alpha`, `beta`, `rc`, or `stable` |
| `version_bump` | `patch`, `minor`, or `major` |
| `npm_tag` | Optional dist-tag override |
| `dry_run` | Print the version and tarball without publishing |

The workflow:

1. installs dependencies and runs `npm run check`;
2. computes the next version (pre-release numbers come from the registry);
3. writes the version with `npm version --no-git-tag-version`;
4. runs `npm pack --dry-run`;
5. publishes with `npm publish --provenance --tag <dist-tag>`;
6. commits the version bump and creates `codex-pushtodisplay-v<version>`;
7. verifies the published version with `npm info`.

Stable releases use `latest`. Pre-releases use `alpha`, `beta`, or `rc` unless
`npm_tag` overrides it.

## Release steps

1. Merge the release-ready change to `main`; CI must be green.
2. Run **Actions > Publish** with `dry_run: true` first.
3. Re-run with `dry_run: false`.
4. Confirm:
   ```bash
   npm view codex-pushtodisplay version
   npm view codex-pushtodisplay dist-tags
   npm pack codex-pushtodisplay@<version> --dry-run
   ```
5. Install through the npm marketplace entry in an isolated `CODEX_HOME` and
   confirm `codex plugin list --json` shows the version.

## Versioning and tags

- `package.json` and `.codex-plugin/plugin.json` versions must match. The
  manifest test enforces it.
- The workflow updates `package.json` only. If a root portable `plugin.json`
  becomes the primary manifest, add it to the version step.
- Git tags use `codex-pushtodisplay-v<version>`.
- Do not reuse a version; npm rejects overwrites.

## Branch protection

The workflow commits the version bump and tag. If branch protection blocks the
GitHub Actions bot, either allow the bot to bypass or drop the commit/tag steps
and tag the release manually. Do not disable branch protection wholesale.

## Rollback

npm does not permit republishing a version. If a release is broken:

1. publish a fixed patch;
2. move the `latest` dist-tag to the fix;
3. deprecate the broken version:
   ```bash
   npm deprecate codex-pushtodisplay@<bad-version> "broken; use <fixed-version>"
   ```

## Security

Do not print, commit, or paste npm tokens. Prefer OIDC. If a token is required,
store it only as the repository secret `NPM_TOKEN` and rotate it after the
bootstrap.
