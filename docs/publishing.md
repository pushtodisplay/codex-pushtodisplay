# Publishing

The npm package is `codex-pushtodisplay`. Its version lives in three places and
must stay identical:

- `package.json`
- `plugin.json`
- `.codex-plugin/plugin.json`

The test suite enforces the match. `prepublishOnly` runs the full check, so a
broken manifest, hook wiring, lint, typecheck, or test fails the publish.

## One-time setup

1. Sign in to npm with an account that can publish the package:

   ```bash
   npm login
   npm whoami
   ```

2. Make sure the GitHub repository is `pushtodisplay/codex-pushtodisplay` and
   Actions are enabled.

3. The **first** publish creates the package. npm Trusted Publishing is
   configured on the package settings page, so it can only be enabled after the
   first version exists.

## First publish (0.1.0, completed)

`0.1.0` is already published. This section is kept as the bootstrap record; use
the ongoing release steps below for later versions.

From a clean checkout:

```bash
npm ci
npm run check
npm pack --dry-run
```

Review the dry-run file list. It should contain the manifests, `hooks/`, `lib/`,
`scripts/`, `skills/`, `commands/`, `vendor/pushtodisplay/`, `docs/`, README, and
LICENSE. It must not contain `test/`, `eslint.config.mjs`, `tsconfig.json`,
`.github/`, `.agents/`, or `node_modules/`.

Bootstrap the package with a local publish. A local publish cannot generate npm
provenance because npm requires an OIDC-capable CI environment for that:

```bash
npm publish --access public
npm view codex-pushtodisplay@0.1.0 version dist.tarball
```

If npm returns `EOTP`, the account or token requires a one-time password. A
2FA-required token cannot publish from CI. Complete the first publish
interactively with an OTP, create a granular automation token that is allowed to
bypass 2FA, or configure Trusted Publishing before using the workflow. Never put
an OTP or token in the repository.

Then test a real install from the registry:

```bash
tmp="$(mktemp -d)"
cd "$tmp"
npm init -y >/dev/null
npm install codex-pushtodisplay@0.1.0
test -f node_modules/codex-pushtodisplay/vendor/pushtodisplay/dist/cli.js
echo "vendored CLI present"
```

Also install through Codex's npm source using the personal marketplace entry in
[distribution.md](distribution.md), then confirm the plugin and its hooks appear:

```bash
codex plugin list --json
codex plugin add pushtodisplay@pushtodisplay-npm
```

## Configure Trusted Publishing

After 0.1.0 exists:

1. Open the package on npmjs.com.
2. Go to **Settings → Publishing access → Trusted publishing**.
3. Add a GitHub Actions publisher:
   - Organization or user: `pushtodisplay`
   - Repository: `codex-pushtodisplay`
   - Workflow filename: `publish.yml`
   - Environment: `npm` (optional, but recommended if you protect it)
4. Save. Future releases can publish with OIDC and `--provenance` without a
   long-lived token.

If Trusted Publishing is not available for the account, create a granular npm
automation token and add it as the repository secret `NPM_TOKEN`. The publish
workflow reads that secret when present. Never commit a token or print it in
logs or chat.

A normal publish token that still requires a one-time password will fail in CI
with `EOTP`; CI cannot answer the OTP prompt. Use an automation token that
bypasses 2FA, or configure Trusted Publishing and let OIDC authenticate the
workflow. A first publish from a local terminal can prompt for the OTP, but the
published artifact then has no provenance statement.

## Ongoing releases

1. Bump the version in all three files:

   ```bash
   npm version patch --no-git-tag-version
   # Then set the same version in plugin.json and .codex-plugin/plugin.json.
   ```

2. Run the checks and inspect the package:

   ```bash
   npm ci
   npm run check
   npm pack --dry-run
   ```

3. Commit and tag:

   ```bash
   git add package.json package-lock.json plugin.json .codex-plugin/plugin.json
   git commit -m "Release vX.Y.Z"
   git tag "vX.Y.Z"
   git push origin main --tags
   ```

4. Publish through GitHub Actions. Either create a GitHub release for the tag or
   run **Actions → Publish → Run workflow**. The workflow uses
   `npm publish --provenance --access public`; with Trusted Publishing it needs
   only `id-token: write`, and with a token it also uses `secrets.NPM_TOKEN`.

5. Verify the release:

   ```bash
   npm view codex-pushtodisplay version dist.tarball
   npm view codex-pushtodisplay@X.Y.Z --json | grep -i provenance
   ```

6. Install the published version in a temporary directory and, for the real
   plugin path, through Codex's npm source. Confirm `/hooks` shows the
   `pushtodisplay` hook source and that a test entry reaches the board.

## Manual fallback

If the workflow is unavailable, publish from a machine with npm credentials:

```bash
npm ci
npm run check
npm publish --access public
```

Provenance is only generated in the GitHub Actions workflow. Do not claim a
provenance attestation for a local publish.

## Rollback and deprecation

npm does not allow republishing the same version. If a release is broken:

- deprecate it: `npm deprecate codex-pushtodisplay@X.Y.Z "reason"`
- publish a fixed patch
- update the repository marketplace tag or README if the install path changes

Do not delete versions that users may already have installed.
