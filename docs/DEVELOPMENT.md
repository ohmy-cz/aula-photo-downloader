# Development contracts

## Boundaries

- `api/`: implemented v25 DTOs, response validation, approved gallery URLs and bounded API negotiation.
- `api.ts`: inclusive date filtering and complete in-memory collection before any processing starts.
- `background.ts`, `background/requests.ts`: sender/activation checks, serialized events and tab-bound `begin`, `process`, `status`, `cancel`, `finish` operations.
- `downloads/`: one current operation, credential-free media processing, Chrome receipt confirmation and restart-safe download spacing.
- `storage/repository.ts`: schema-4 gallery/filter-to-date map in local storage, active-run/current-operation state in trusted session storage. No migrations, historical receipts, saved capture plans or filename index.
- `runtime/`: offscreen ownership, bounded fetch/worker lifetime and leased local blobs. Processing failures download nothing.
- `metadata/`: camera-filename dates, otherwise estimated upload-order times near noon in Copenhagen, plus photo metadata and verified video remuxing. Repeated wall times choose the later occurrence; spring gaps are rejected.
- `ui/material/`: modeless React/MUI panel, automatic popup launch, scoped shadow-root styling, cancellation and receipt progress.

A run begins only after collection succeeds, with its expected file count, album folder, inclusive date bounds and submission day captured before collection. One run owns the worker; opaque IDs bind it to its tab. Only a complete successful current import advances its date. Stop, failures, historical ranges and closed tabs cannot advance it. Ordinary service-worker suspension recovers the active Chrome receipt, including a lost download-ID write, without counting it twice. Closing a batch discards its operation; later imports may download the same files again.

Only the last successful date per canonical gallery/profile-filter hash persists. Boundaries are inclusive; Chrome adds collision suffixes. Album folders and estimated capture times are recomputed per run. Existing downloaded files are never removed or overwritten. No gallery field verifies the signed-in account; use separate browser profiles or All times after switching accounts.

Changing albums clears the panel's counts, errors and API warning immediately and cancels the previous queue. A current file keeps its original album folder and must settle before another run can start. The newly selected album restores only its own import date; late replies from previous selections cannot change its state.

## Aula API upgrades

The implemented contract is **gallery.getMedia v25**. `config.json` selects the implemented transport version, and the adapter checks each response's version against the requested endpoint. Changing only the setting still fails explicitly.

Each collection first tries the implemented version. Only HTTP 404/410 (removed/retired endpoints) enables compatibility probing, capped by `aula.maxApiVersionProbes` for the whole collection. Prefer a newer version observed in the current gallery request; otherwise try the next integer version. Preserve the gallery, filters, ordering and current pagination offset. Authentication errors, outages, network failures and incompatible responses do not trigger probes.

A newer version must satisfy the implemented DTO's required fields, field types, envelope and pagination checks before any media enters the queue. Extra fields are ignored. Optional/nullable fields retain the v25 contract; unavailable originals stay visible and block false completion. Missing or changed required fields stop collection, discard the partial queue and preserve the previous checkpoint. Validating shape cannot prove unchanged API semantics, so the panel keeps a translated compatibility warning visible throughout collection, processing and completion. A later successful use of the implemented API clears it.

For a future version:

1. Obtain a sanitized response with documented provenance. Keep real names, IDs, institutions and signed URLs out of fixtures.
2. Add a version-specific schema/mapper returning the same internal DTO. Require consumed fields; allow unrelated additions. Keep unavailable items visible so they block false completion.
3. Register that adapter and update the configured version together. Keep the current canonical gallery/filter identity.
4. Test version mismatches, missing/changed tags, null dates/URLs, error envelopes, both sort orders, overlapping and alternating pages, and bounded streams.

`tests/fixtures/aula/gallery-v25.json` preserves the observed v25 field structure with entirely synthetic values, including names, IDs, timestamps and media URLs. No live response or Aula photograph is retained. Mock envelopes share that fixture rather than being generated from production schemas. HTTP 404/410 triggers bounded compatibility probing; exhausted probes report an unsupported API version. The staged-file privacy hook and CI reject unreviewed fixtures and captures; follow AGENTS.md before adding or updating test data.

## Verification

`Monitor Aula API` checks public scripts daily at 07:23 UTC or on manual dispatch. A version newer than `config.json` opens one issue mentioning the owner (override with repository variable `AULA_API_NOTIFY_USER`); open and closed alerts prevent repeats. Enable GitHub mention/email notifications. Missing, conflicting or unavailable declarations fail the workflow. No login, remote script execution or automatic API upgrade occurs. Check locally without GitHub access: `npm run monitor:aula-api -- --detect-only`.

`npm test` runs workflow integration scenarios for downloads, recovery, message authorization, activation, duplicate imports and checkpoint/DST behavior. The workflow scenarios use mocked Chrome/Aula APIs and actual UI bundles. Isolated helper/schema unit suites and intermediate-state checks are excluded. Test doubles and bundle setup live in `tests/helpers/`; typed ESLint and TypeScript check promises and unused declarations.

`test:wasm` runs the actual bundled worker for JPEG, PNG, TIFF, HEIC and supported video containers with multiple audio tracks and an embedded subtitle and verifies metadata. Native ExifTool independently checks output when installed. Set `FFMPEG` to a native executable for independent decoded payload comparisons. Generated verification files live in a temporary directory.

`test:browser` uses a disposable Chrome for Testing installation supplied via `CHROME_PATH`. Its synthetic gallery and media use distinct HTTPS origins. `scripts/browser/` owns server/browser setup and cleanup, while the entry script contains lifecycle scenarios: collection, stopping, worker restart, receipt recovery and API compatibility warnings. CI runs native verification on Linux, macOS and Windows; local success does not prove other platforms passed. Minimum-version compatibility and authenticated Aula/Immich checks remain release checks.

UI verification includes keyboard opening/closing, focus return, Escape, small viewports/zoom, readable contrast and reduced motion. The panel is modeless: it must not trap focus or block Aula keyboard navigation while hidden.

The UI uses React 19 and Material UI 9 with path imports, a shared theme, semantic labels, system fonts without network requests, and React Hooks lint rules. Follow the [MUI MCP setup](https://mui.com/material-ui/getting-started/mcp/) and [shadow DOM integration](https://mui.com/material-ui/customization/shadow-dom/) when changing it. The official `@mui/mcp` documentation server was used during migration; it is a development tool, never bundled in the extension.

Opening the extension on a selected album immediately injects the downloader and records tab activation. The child-name export setting lives in the downloader, defaults on and is bound to the run. An explicit opt-out is retained across album switches on the same page. Content actions require trusted clicks; only the originating tab may act on a run. Downloads use leased processed blobs, never unrestricted remote URLs or fallback copies.

Run `npm run demo` and open `http://127.0.0.1:8765/?newerApi=1&fresh=api-fallback` to simulate retirement of the implemented API and inspect the warning without contacting Aula or changing real download history.

`/popup-preview?fail=1` renders the actual automatic-launch popup with local Chrome mocks. Behavioral tests cover the two screens, all four languages, checkpoint/DST behavior and trusted-action boundaries. Release workflow checks additionally exercise version gating, published-tag conflicts and safe draft/rerun behavior without publishing test releases.

## Immich

The integration follows the released Immich v3.4.1 OpenAPI contract. Standard extension options request access to the configured server only; API keys stay in trusted local storage. Required key permissions are `user.read`, `album.read`, `asset.read`, `asset.upload` and `albumAsset.create`. `immich/client.ts` validates consumed response fields and uses native multipart upload; uploads run in the offscreen document so service-worker suspension does not interrupt them. Each connection/album has a separate checkpoint. The last album choice persists locally; missing choices fall back to the newest writable album.

Imports reuse local metadata processing without Chrome download pacing. Before collection, search the selected album for its newest non-trashed image by `fileCreatedAt`; silently filter only strictly older photos, retaining equal timestamps, videos and files without a capture plan for normal validation. Verify upload, duplicate handling and album assignment with synthetic data when changing the API contract. Never use a real account/key or live media in tests.

## Processing components

`npm audit` covers npm advisories only; it cannot certify bundled native libraries.

For a parser update, obtain the upstream source/build configuration, review engine and enabled-library advisories, update the pinned package and build instructions, run malformed-input and full metadata/payload checks, and preserve redistribution notices/source obligations. Never edit a generated WASM binary or assume a wrapper version upgrades its embedded engine. See SECURITY.md for the current FFmpeg risk.
