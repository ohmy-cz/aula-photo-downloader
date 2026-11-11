# Contributing

Use Node.js 22.13 or newer; CI uses Node.js 24. Install the exact dependency tree without lifecycle scripts:

```sh
npm ci --ignore-scripts
npm run prepare
npm run privacy:check
npm run lint:fix
npm run lint
npm run typecheck
npm test
npm run build
```

Load `dist/` as an unpacked extension for local use. The package is intentionally private to prevent accidental publication to npm. Do not commit `dist/`, release archives or downloaded user files, and do not create a release ZIP during ordinary development.

Install Gitleaks 8.30.1 or newer locally (for example, `brew install gitleaks` on macOS). `npm run prepare` installs Husky's pre-commit hook: it checks the exact staged files for unreviewed media/data, identifying fixture literals and secrets. CI repeats the privacy check. Use only synthetic test data; keep live Aula captures outside the repository. Inspect decoded media and metadata before approving a fixture digest. See [AGENTS.md](AGENTS.md) for the privacy rules; automated checks do not replace manual review.

`npm test` covers workflow integration and saved-date persistence. Keep scenarios focused on observable outcomes across modules; use the bundled-worker and installed-extension checks below for full engine/browser verification.

Metadata or timezone changes also require `npm run test:wasm`. Install native FFmpeg to generate synthetic fixtures and ExifTool for independent verification; `FFMPEG=ffmpeg npm run test:wasm` compares decoded media payloads as well as metadata. Outputs stay in temporary directories.

For the installed-extension lifecycle test, set `CHROME_PATH` to an official Chrome for Testing executable and run `npm run test:browser`. It uses generated HTTPS fixtures and an isolated browser profile, never your logged-in Aula session or existing downloads. Its temporary certificate settings apply only to that test browser. CI runs this check on Linux and native metadata checks on Linux, macOS and Windows.

Use `npm run demo` to inspect the UI with synthetic data. Add `?newerApi=1&fresh=api-fallback` to the local demo URL to exercise API retirement and the compatibility warning.

Before publishing source, use Gitleaks 8.30.1 or newer and run:

```sh
gitleaks dir . --config .gitleaks.toml --max-archive-depth 3 --ignore-gitleaks-allow --redact --no-banner
gitleaks git . --config .gitleaks.toml --log-opts="--all" --max-archive-depth 3 --ignore-gitleaks-allow --redact --no-banner
npm audit --audit-level=high
```

Scans retain Gitleaks' upstream default rules and exclusions (including dependencies and common binary formats), with no added directory exclusions; one rule-specific exception matches an exact function-pointer expression in the pinned FFmpeg source. CI separately scans the exact release ZIP, including nested source archives, before publication. Gitleaks does not identify all personal data: inspect the ZIP's contents for private media, names, signed URLs and unexpected files. Keep these out of source, tests and public reports too. If an actual credential was committed, revoke or rotate it even after deleting the file. Required runtime settings belong in `config.json`; that file contains public defaults, never credentials.

Follow [AGENTS.md](AGENTS.md) for code style. Keep refactors focused, import directly from the owning module, preserve download completion semantics and reset incompatible saved state without migrations, and update relevant tests and contracts. New dependencies must replace meaningful custom logic, be pinned in the lockfile, and have their redistribution notices included when bundled. Review [SECURITY.md](SECURITY.md) before distributing executable builds.

Video binaries are maintained in `vendor/video/`; its README documents the pinned Docker rebuild. Preserve exact source archives, actual build inputs and license texts in every distributable. Update dependency versions and build instructions after engine changes; never edit a generated binary by hand. `PRIVACY.md` is the policy source; the build renders it into the extension’s `privacy.html`. Complete `docs/PUBLICATION.md` before any Store submission.

Linting and formatting use the shared [Antfu ESLint preset](https://github.com/antfu/eslint-config), including type-aware TypeScript and React checks. HTML uses HTML ESLint's recommended preset. Keep project overrides limited to our arrow-function, brace and spacing preferences and the extension/Node test environment; no separate formatter is used. Run `npm run lint` (zero warnings required) or `npm run lint:fix` for automatic fixes. CI and release packaging run lint. Generated builds and upstream vendor code are excluded; maintained sources and test fixtures are checked. Do not suppress errors to get a clean run.

## Releases

Increase the numeric Chrome-compatible version in `package.json` and both root version fields in `package-lock.json` in every PR to `main`, including documentation changes. The build generates the manifest version from that package version.

After a push to `main`, CI checks the version, secrets, lint, formatting, types, integration tests, dependencies, real engines and installed extension. It publishes the checked Linux ZIP as `v<package version>`, with the stable asset name `aula-photo-downloader.zip`. Releases remain alpha in their description. Published tags/assets are never replaced; rerunning the same checked commit is safe. The first successful run makes the README download link available.
