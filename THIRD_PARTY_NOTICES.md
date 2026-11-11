# Third-party notices

Aula Photo Downloader includes @colorhythm/exiftool-wasm 1.0.4 (Apache-2.0), which packages zeroperl/WASI glue and Phil Harvey's ExifTool. ExifTool is licensed under the same terms as Perl itself (Artistic License or GNU GPL).

Upstream: https://github.com/colorhythm/exiftool-wasm
ExifTool: https://exiftool.org/ — https://github.com/exiftool/exiftool

Bundled license texts are included in the licenses folder of the distributable.

Video processing uses a locally rebuilt, restricted FFmpeg 5.1.10 core under LGPL-2.1-or-later, without GPL/nonfree codecs or external codec libraries. ffmpeg.wasm bindings retain their MIT license; FFmpeg-derived command-line files retain their upstream LGPL notices. The project license does not replace these component licenses.

Exact source archives, actual modified build inputs, compiler image, build commands and replacement instructions are in `sources/video/` in every build (maintained under `vendor/video/` in this repository). Users may rebuild and replace the separate core. Preserve those files and `licenses/FFmpeg-LGPL-2.1.txt` when redistributing; do not ship binary-only archives. Emscripten uses its existing MIT/NCSA licenses, musl uses MIT, and compiler-rt uses Apache-2.0 with LLVM exceptions. Their notices are included in `licenses/`.

The ExifTool WASM executable is named `assets/exiftool.wasm` and exposes a browser worker interface rather than the standard native CLI. We select the existing Artistic License option for ExifTool/Perl. Obtain the standard ExifTool distribution at https://exiftool.org/ or its 13.59 source at https://github.com/exiftool/exiftool/tree/13.59; the packaging sources remain available at https://github.com/colorhythm/exiftool-wasm. ExifTool and its authors are credited independently of this project.

Our build modifies only the photo WASM memory declaration to enforce a 512 MiB maximum; its code and data remain unchanged.

Wire-contract validation includes Zod 4.6.7 (MIT), https://github.com/colinhacks/zod. Its license is bundled as licenses/ZOD-MIT.txt.

Archive timezone handling uses @js-temporal/polyfill 0.5.1 (ISC), https://github.com/js-temporal/temporal-polyfill, and its JSBI 4.3.2 dependency (Apache-2.0), https://github.com/GoogleChromeLabs/jsbi. Their license texts are bundled as licenses/Temporal-ISC.txt and licenses/JSBI-Apache-2.0.txt.

UI translation includes i18next 26.4.2 and i18next-browser-languagedetector 8.2.1 (both MIT), https://github.com/i18next/i18next and https://github.com/i18next/i18next-browser-languageDetector. Their license texts are included in licenses/.

The interface uses React and React DOM 19.3.1 (MIT), https://github.com/facebook/react; Material UI and Material Icons 9.5.0 (MIT), https://github.com/mui/material-ui; and Emotion 11 (MIT), https://github.com/emotion-js/emotion. Builds copy the actual license and copyright notices for every bundled JavaScript dependency, including transitive and nested versions, into `licenses/`.
