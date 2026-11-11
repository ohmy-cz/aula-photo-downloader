# Aula Photo Downloader

[![Checks](https://github.com/ohmy-cz/aula-photo-downloader/actions/workflows/checks.yml/badge.svg?branch=main)](https://github.com/ohmy-cz/aula-photo-downloader/actions/workflows/checks.yml)
[![Latest release](https://img.shields.io/badge/release-latest-blue)](https://github.com/ohmy-cz/aula-photo-downloader/releases/latest)
[![Project license](https://img.shields.io/badge/project%20license-MIT-blue)](LICENSE)

## Motivation
When you try to download photos from Aula, those have all metadata striped; presumably for privacy and security reasons. Among those, the photo capture date is removed too.

This causes the downloaded photos to appear in random order on your computer and wherewer you backup your photos; on Google Photos, Immich, etc.

I found this infuriating, because the capture/upload date sits right next to the photo in Aula's interface.

Hence the __Aula Photo Downloader__.

This nifty Chrome plugin allows you with two clicks to download the photos you have access to, tagged with the date/time shown in Aula; additionaly it tags the people in the photos in those files too for further taxonomy.

## Privacy considerations
**Photo tagging happens entirely on your device. Photos stay on your computer unless you choose to import them to your configured Immich server.** No telemetrics are sent anywhere.
Effectively, this plugin can *only* "see" what you see on your screen; it only works with the data you had been granted access to and "glues" those on the files you were given the right to download. no witchcraft here. This plugin is read-only in relation to Aula.

## Install

Requires desktop Chrome 117 or newer.

1. [Download the latest build (ZIP)](https://github.com/ohmy-cz/aula-photo-downloader/releases/latest/download/aula-photo-downloader.zip).
2. Extract the ZIP on your computer somewhere permanent (i.e. _not_ in Downloads).
3. In Chrome, open `chrome://extensions` and enable **Developer mode**.
4. Click **Load unpacked** and select the extracted folder containing `manifest.json`.
5. Open Chrome's **Extensions** menu (puzzle icon) and pin **Aula Photo Downloader** for easy access.

## Open the target album in Aula

1. Log into [Aula](https://www.aula.dk) in Chrome.
2. Open **Gallery / Galleri**, then the relevant gallery/album.
3. Open the plugin in your Chrome, to the right of the URL bar.
4. You should now see the Plugin interface. Select the dates to get the pictures for, or select from "now" to "all times" checkboxes.
5. Click "Download". Pictures will be downloaded to your computer one by one. This will take a while*

*there's an arbitrary one second delay between each photo; that is to give them sequential timestamps when downloaded on your computer, so they keep in their natural order without having to prefix the file names with a date.

## Design choices

- **Album-bound downloads.** Switching albums resets the stats and stops the previous queue. A file already in progress finishes in its original album folder.
- **Keep original filenames.** Successful downloads keep Aula's filenames, with safety cleanup and suffixes for name collisions. Chronological sorting uses capture-date metadata instead of added date prefixes.
- **Keep original quality.** Download original media rather than thumbnails, and update metadata without re-encoding photos or audio/video. Processing stays on your computer; Aula's copies remain untouched.
- **Easy to use again and again**: the plugin remembers the last time you downloaded images, and will automatically select that date as a cutoff date to prevent duplicates.
- **Optional Immich import.**

## Disclaimers

__Use this sowtware at your own risk__. No guarantees given.

This independent project is not an official Aula product and is not affiliated with or endorsed by Aula, KOMBIT or Netcompany.

All trademarks, product names and logos mentioned in this project, including Aula, are the property of their respective owners.

**Supported Aula API: v25.** If that endpoint is retired, the extension tries newer versions with response validation and a visible compatibility warning. Newer versions may not work as expected, although this plugin accesses Aula read-only, so you can go ahead and try. Ideally, a new version of thid plugin would follow soon to resolve the compatibility issues as they arise - but I can't give guarantees here.

## Misc

Read [Privacy](PRIVACY.md), [Security](SECURITY.md) and [Publishing](docs/PUBLICATION.md) before distributing a build. Aula API automation permission remains unverified.

See [Contributing](CONTRIBUTING.md) for checks and [Development](docs/DEVELOPMENT.md) for architecture and API contracts. Report bugs with synthetic examples; never include private media, names, cookies, or signed URLs.

Project code uses the [MIT license](LICENSE). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for bundled components.
