# Privacy

Updated 11 November 2026. Applies to Aula Photo Downloader, an independent extension for private media archiving.

## What it uses

When you press Start in the downloader, it reads your selected Aula gallery using your existing login. It accesses media, filenames, upload dates, album titles, tags and signed download URLs. It does not read your password or copy login cookies. Existing photo location metadata is preserved. Exporting tagged children's names into photo metadata is optional and off by default; enable it in the downloader.

## Where data goes

Processing happens on your computer. Requests go only to Aula and its configured media service. We receive no media or account data and provide no analytics, advertising, uploads or remote error reporting. Data is used only for the disclosed archiving features, in accordance with the Chrome Web Store User Data Policy's Limited Use requirements. We do not sell or share it with other parties.

## Storage and deletion

Browser-local storage contains only successful import dates, indexed by a hash of the gallery and profile filters. These dates remain until you clear them or uninstall the extension; they are not encrypted by the extension. Incompatible saved state resets without migration.

The active run and its current/latest operation use trusted session storage. Active filenames, album folder, signed URLs and child names are discarded when the batch closes or the browser restarts. Closing the tab cancels its batch; an already-started download may finish. Interrupted imports do not resume and may download completed files again.

Use **Clear saved import dates** in the popup when no import is active; open the extension outside a selected album to show it. Uninstalling also removes extension storage. Chrome keeps its own download history. Downloaded media remains on disk: delete it separately, including any copies or backups. Photo metadata may contain other people's names and locations; protect your browser profile and archive.

## Questions

Use the publisher's contact details on the extension's Store listing, or contact the repository maintainer for source builds. Do not include real photos, names, cookies or signed URLs in public issues. A separate browser profile is recommended for each Aula account.
