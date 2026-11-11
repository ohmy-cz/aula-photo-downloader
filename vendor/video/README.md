# Local video core

FFmpeg 5.1.10, commit `19feb712f5c1821d8a3fa1ad63c5bd2e3b9672eb`, from the official FFmpeg repository. `ffmpeg.tar.gz` contains that exact source, including licenses. ffmpeg.wasm bindings come from commit `f876f907c7e9b9bf51d4ed0b913a855a63ae63fc`; `bindings.tar.gz` preserves that upstream snapshot.

`bindings.patch` updates the preserved upstream build inputs: the FFmpeg command-line sources were merged with 5.1.10; compilation is limited to two jobs; SDL/WORKERFS and dynamic JavaScript execution are disabled. The generated core has a 1 GiB memory ceiling. Dockerfile records the exact compiler image and configure arguments. No external codec libraries, GPL/nonfree components or network protocols are enabled. The engine only remuxes supported containers; it does not encode media.

Rebuild with Docker:

```sh
docker build --platform linux/amd64 -t aula-video-build vendor/video
container=$(docker create aula-video-build)
docker cp "$container:/out/ffmpeg-core.js" vendor/video/ffmpeg-core.js
docker cp "$container:/out/ffmpeg-core.wasm" vendor/video/ffmpeg-core.wasm
docker rm "$container"
```

After reviewing sources and advisories, run the repository checks and metadata/payload verification. Build outputs are intentionally vendored so installing the extension does not require Docker. Sources, bindings and build files travel with every distributable under `sources/video/`, allowing users to rebuild and replace the separate core files. The core is LGPL-2.1-or-later; the ffmpeg.wasm glue retains MIT notices. Project code remains MIT. Keep the included licenses and attribution. No source-delivery promise depends on a future download URL.
