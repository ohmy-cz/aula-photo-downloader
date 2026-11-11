# Publishing

Project code uses the existing [MIT license](../LICENSE). Bundled components keep their own licenses; include [third-party notices](../THIRD_PARTY_NOTICES.md), license texts and the exact corresponding video source/build files with every binary distribution. Do not describe the entire package as MIT-only.

Before publishing to the Chrome Web Store:

1. Host [the privacy policy](../PRIVACY.md) at a stable public URL; enter it in the Developer Dashboard. Set a real publisher/support contact. No publisher URL or email is assumed by this repository.
2. Describe the single purpose: locally archive media the user may access in Aula, with dates and optional child tags. Explain saved import dates, temporary active-run data and retained location metadata. Mark it as independent of Aula/KOMBIT/Netcompany. Do not claim certification or endorsement.
3. Complete the privacy declarations accurately: the extension handles website content and personal information locally, even though the developer receives none. Explain `activeTab`/`scripting` (selected gallery), `storage` (import dates and active-run recovery), `downloads` (media archive), `offscreen` (local processing), and media-host access (original files).
4. Run the checks in [Contributing](../CONTRIBUTING.md), verify the packaged source/licenses, and test the built extension. Register and secure the publisher account; keep listing and policy consistent with actual behavior.

## GitHub releases

Before making the repository public, scan source and all fetched Git history as described in [Contributing](../CONTRIBUTING.md). Review the exact release ZIP's contents for personal media or other private data; a clean secret scan cannot establish that these are absent. Revoke or rotate any real credential found, including one removed from the current files.

Merges to `main` publish only after all CI verification succeeds. `package.json` supplies the manifest version and `v<version>` tag; PRs must increase it and keep the lockfile consistent. The release includes `aula-photo-downloader.zip`, with its manifest at the archive root and all bundled licenses/corresponding sources. Published releases are preserved; failed drafts can be retried. GitHub’s regular-release designation enables the stable latest-download link; the product remains an independent alpha. GitHub distribution does not submit the extension to the Chrome Web Store.

## Aula and lawful use

Use your own authorized session and respect your institution's applicable terms and photo rules. Access to a photo does not grant rights to republish it. Never bypass login, permissions or access restrictions. Professional/school use requires its own data-protection assessment; household use is a different context.

[KOMBIT advises parents to save pictures before access ends](https://aulainfo.dk/om-aula/data-og-sikkerhed-i-aula). That does not expressly authorize automated use of Aula's private API. **The applicable accepted terms and permission for automation remain unverified.** Resolve this with the relevant terms or an authorized Aula/KOMBIT/Netcompany contact before claiming approval. Do not invent permission or treat this document as legal clearance.

Sources: [Chrome privacy policy rules](https://developer.chrome.com/docs/webstore/program-policies/privacy), [disclosure rules](https://developer.chrome.com/docs/webstore/program-policies/disclosure-requirements), [Developer Agreement](https://developer.chrome.com/docs/webstore/program-policies/terms), [Danish household/privacy guidance](https://www.datatilsynet.dk/borger/sociale-medier).
