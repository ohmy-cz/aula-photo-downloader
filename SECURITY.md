# Security

Reviewed 11 November 2026. This describes controls and limits, not a security certification.

## Boundaries

- Only this extension's content script on the exact Aula origin can submit validated media. Opening the toolbar extension activates the tab without a consent screen. Start rejects synthetic clicks. The in-page controls share Aula's DOM, so trusted clicks do not prevent a compromised Aula page from disguising those controls. The API uses the existing Aula login; the extension does not read passwords or cookie values or bypass access checks.
- Original fetches accept only the configured HTTPS media origin, omit credentials, reject redirects and enforce the streamed byte limit. Processing, fetch and size failures create no fallback download. Unrecognized filename extensions become `.bin`, keeping media names inert.
- Typed DTO validation, bounded pagination/queues, exact sender checks and serialized storage changes protect privilege boundaries. API fallback tries bounded newer versions only after HTTP 404/410; valid shape does not prove unchanged semantics. The warning remains visible.
- Processing code and WASM are packaged locally. Each file uses a dedicated, terminated worker, with time limits and expiring output blobs. Photo WASM memory is capped at 512 MiB; extraction requests only required tags, JSON metadata is limited to 1 MiB and processed files to 256 MiB. These are separate budgets, not a total browser-memory limit. Video uses a restricted core, explicit container demuxers, local-only protocols and copied streams. Read-back checks compare metadata and encoded payloads.

## Local data

Active URLs, filenames and child tags use trusted session storage. An opaque run ID is bound to its originating tab; other tabs cannot poll, cancel or finish that run. Only a confirmed complete batch can advance its saved date. Chrome receipts and blob ownership survive ordinary service-worker suspension; there is no cross-session batch resume or per-file catalog.

Persistent storage contains only gallery/filter hashes and successful import dates. Incompatible state is discarded without migration; no downloaded files are deleted. There are no native scripts, executable command exports, clipboard permissions or persistent diagnostics. Chrome retains its own download history. The popup clears saved data only when no import/download is active. Separate browser profiles are recommended for different Aula accounts because gallery keys do not verify account identity. See [Privacy](PRIVACY.md).

## Dependencies and distribution

The local video core and its complete build inputs are documented in [vendor/video](vendor/video/README.md); corresponding sources and existing license texts accompany distributions. An npm audit does not cover embedded parsers. Review upstream advisories whenever updating them; a newer version is not proof of safety.

Restricted parsing and WASM isolation reduce exposure but cannot eliminate malformed-file bugs or resource exhaustion. Photo archives retain existing location metadata; optional child tags travel with shared files. Video remuxing may normalize other metadata.

## Verification and reporting

Run the checks in [Contributing](CONTRIBUTING.md), including `test:wasm` after engine changes. Synthetic tests are not proof of authenticated Aula behavior or every supported browser/OS combination. Before a release, verify the actual installed build and applicable Aula terms as described in [Publishing](docs/PUBLICATION.md).

Report vulnerabilities privately to the published repository's maintainer, using GitHub private vulnerability reporting when enabled. Include versions and a synthetic reproduction; never include real media, names, cookies, signed URLs or storage exports in public issues. This extension has no remote reporting service.
