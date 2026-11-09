# Vendored pushtodisplay CLI

This directory contains the pinned `pushtodisplay` CLI release **0.1.19**,
copied from the published npm package:

- `dist/` — the compiled CLI
- `package.json` — upstream package metadata
- `LICENSE` — upstream license
- `README.md` — upstream README
- `THIRD_PARTY_LICENSES.txt` — upstream third-party notices

## Why vendored

The published `pushtodisplay@0.1.19` package includes an `npm-shrinkwrap.json`
whose dev dependency tree makes `npm ci` install hundreds of unrelated packages
and fail with `EBADPLATFORM` on some operating systems. Vendoring the exact
release keeps the plugin self-contained, keeps `npm ci` reproducible, and avoids
depending on that shrinkwrap.

The plugin still prefers a `PUSHTODISPLAY_CLI` override, then this vendored copy
(or an installed `node_modules/pushtodisplay`), then a binary on `PATH`, and
finally the pinned `npx --yes pushtodisplay@0.1.19` fallback.

## Updating

1. Download the new release:

   ```bash
   npm pack pushtodisplay@X.Y.Z
   tar -xzf pushtodisplay-X.Y.Z.tgz
   ```

2. Replace `dist/`, `package.json`, `LICENSE`, `README.md`, and
   `THIRD_PARTY_LICENSES.txt` with the files from the new package. Do **not**
   copy `npm-shrinkwrap.json`.

3. Update `PUSHTODISPLAY_CLI_VERSION` in `lib/cli-adapter.mjs` and the pinned
   `npx` references in the README, docs, skills, and commands.

4. Run `npm run check`, then `npm pack --dry-run`, and verify that
   `vendor/pushtodisplay/dist/cli.js` is included.
