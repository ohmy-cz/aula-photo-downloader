import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
// Exercise the actual browser worker bundle with Node's worker transport and local fetch shim.
import { Worker } from 'node:worker_threads'

const settings = JSON.parse(await readFile('config.json', 'utf8'))

// Verify the packaged heap ceiling without running Perl or allocating the full budget.
const photoModule = await WebAssembly.compile(await readFile(`dist/${settings.browser.wasmAsset}`))

const imports = {}

for (const entry of WebAssembly.Module.imports(photoModule)) {
  assert.equal(entry.kind, 'function')

  imports[entry.module] ??= {}

  imports[entry.module][entry.name] = () => 0
}

const { memory } = new WebAssembly.Instance(photoModule, imports).exports

assert(memory instanceof WebAssembly.Memory)

assert.throws(
  () => memory.grow((settings.limits.photoWasmMemoryBytes - memory.buffer.byteLength) / 65536 + 1),
  RangeError,
)

// Node supplies the transport and a local fetch shim; the exercised code is the actual bundle.
const workerUrl = pathToFileURL(
  resolve(`dist/${settings.browser.workerScript}`),
).href

const wrapper = `
  const { parentPort } = require('node:worker_threads');
  const fs = require('node:fs/promises');

  global.self = global;
  global.location = { href: ${JSON.stringify(workerUrl)} };
  global.importScripts = () => {};
  global.fetch = async url => new Response(await fs.readFile(new URL(url)), {headers: {"Content-Type": "application/wasm"}});
  global.postMessage = (message, options) => parentPort.postMessage(message, options?.transfer);

  import(${JSON.stringify(workerUrl)}).then(() => {
    parentPort.on('message', data => global.onmessage({ data }));
  });
`

const directory = await mkdtemp(join(tmpdir(), 'aula-wasm-'))

const generated = []

// Native FFmpeg generates synthetic encoded fixtures; the restricted shipped core never encodes.
const nativeFFmpeg = process.env.FFMPEG || 'ffmpeg'

/** Generate fixtures outside user folders, independently of the engine being verified. */
const generate = args =>
  execFileSync(nativeFFmpeg, ['-nostdin', '-y', ...args], {
    cwd: directory,
    stdio: 'pipe',
  })

const inputs = new Map()

for (const extension of ['mp4', 'mov', 'mkv', 'webm']) {
  const target = `original.${extension}`

  generate([
    '-v',
    'error',
    '-i',
    resolve('tests/fixtures/sample.mp4'),
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=0.2',
    '-map',
    '0:v',
    '-map',
    '1:a',
    '-map',
    '1:a',
    '-metadata:s:a:1',
    'language=dan',
    '-metadata:s:v:0',
    'rotate=90',
    '-c:v',
    extension === 'webm' ? 'libvpx' : 'copy',
    '-c:a',
    extension === 'webm' ? 'libopus' : 'aac',
    '-metadata',
    'title=Synthetic archive test',
    target,
  ])

  inputs.set(extension, await readFile(join(directory, target)))
}

generate([
  '-v',
  'error',
  '-i',
  resolve('tests/fixtures/sample.png'),
  '-frames:v',
  '1',
  'original.tiff',
])

inputs.set('tiff', await readFile(join(directory, 'original.tiff')))

await writeFile(
  join(directory, 'caption.srt'),
  '1\n00:00:00,000 --> 00:00:00,200\nSynthetic caption\n',
)

generate([
  '-v',
  'error',
  '-i',
  'original.mkv',
  '-i',
  'caption.srt',
  '-map',
  '0',
  '-map',
  '1:s',
  '-c',
  'copy',
  'original.subtitles.mkv',
])

inputs.set(
  'subtitles',
  await readFile(join(directory, 'original.subtitles.mkv')),
)

await writeFile(join(directory, 'original.subtitles'), inputs.get('subtitles'))

inputs.set(
  'heic-metadata',
  await readFile('tests/fixtures/metadata-only.heic'),
)

const videoTypes = new Set(['mp4', 'mov', 'mkv', 'webm', 'subtitles'])

for (const [index, extension] of [
  'jpg',
  'png',
  'tiff',
  'heic',
  'heic-metadata',
  'mp4',
  'mov',
  'mkv',
  'webm',
  'subtitles',
  'broken',
  'mislabeled',
  'unsupported',
].entries()) {
  const invalid = ['broken', 'mislabeled', 'unsupported'].includes(extension)

  const fixtureExtension = extension === 'heic-metadata' ? 'heic' : extension

  const prefix
    = extension === 'subtitles'
      ? 'subtitles_'
      : extension === 'heic-metadata'
        ? 'metadata_'
        : ''

  const filename = `${prefix}20260430_095302.${extension === 'unsupported' ? 'avi' : extension === 'subtitles' ? 'mkv' : invalid ? 'mp4' : fixtureExtension}`

  const kind = videoTypes.has(extension) || invalid ? 'video' : 'photo'

  const bytes = invalid
    ? extension === 'broken'
      ? new Uint8Array([1, 2, 3])
      : inputs.get(extension === 'mislabeled' ? 'mkv' : 'mp4')
    : inputs.get(extension)
      || (await readFile(`tests/fixtures/sample.${extension}`))

  const worker = new Worker(wrapper, { eval: true })

  try {
    const result = await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Worker timed out')),
        settings.timing.processingMs,
      )

      worker.on('error', reject)

      worker.on('message', (result) => {
        clearTimeout(timeout)

        resolve(result)
      })

      worker.postMessage({
        id: `fixture-${index}`,
        filename,
        media: {
          id: index + 1,
          filename,
          kind,
          children: ['Synthetic Child A', 'Synthetic Child B æøå'],
          capture: {
            day: '2026-04-30',
            time: '09:53:02',
            offset: '+02:00',
            utc: '2026:04:30 07:53:02',
            basis: 'filename',
          },
        },
        bytes: bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
      })
    })

    if (invalid) {
      assert(result.error, 'Invalid video must require fallback')

      assert.equal(result.bytes, undefined)

      continue
    }

    assert(result.bytes, result.error)

    assert.equal(
      result.mime,
      extension === 'jpg'
        ? 'image/jpeg'
        : extension === 'png'
          ? 'image/png'
          : extension === 'tiff'
            ? 'image/tiff'
            : extension === 'heic'
              ? 'image/heic'
              : extension === 'heic-metadata'
                ? 'image/heif'
                : {
                    mp4: 'video/mp4',
                    mov: 'video/quicktime',
                    mkv: 'video/x-matroska',
                    webm: 'video/webm',
                    subtitles: 'video/x-matroska',
                  }[extension],
    )

    await writeFile(join(directory, filename), new Uint8Array(result.bytes))

    if (extension === 'subtitles') {
      const caption = execFileSync(
        nativeFFmpeg,
        [
          '-v',
          'error',
          '-i',
          join(directory, filename),
          '-map',
          '0:s:0',
          '-c',
          'copy',
          '-f',
          'srt',
          '-',
        ],
        { encoding: 'utf8' },
      )

      assert(caption.includes('Synthetic caption'))
    }

    generated.push({ filename, extension })
  }
  finally {
    await worker.terminate()
  }
}

const tool = process.env.EXIFTOOL || 'exiftool'

try {
  for (const { filename, extension } of generated) {
    const after = JSON.parse(
      execFileSync(tool, ['-j', '-G1', '-s', join(directory, filename)], {
        encoding: 'utf8',
      }),
    )[0]

    if (!videoTypes.has(extension)) {
      assert.equal(
        after['XMP-exif:DateTimeOriginal'],
        '2026:04:30 09:53:02+02:00',
      )
    }

    if (extension === 'jpg') {
      assert(after['XMP-dc:Subject'].includes('Landscape'))

      assert.equal(
        after['GPS:GPSLatitude'],
        JSON.parse(
          execFileSync(tool, ['-j', '-G1', '-s', 'tests/fixtures/sample.jpg'], {
            encoding: 'utf8',
          }),
        )[0]['GPS:GPSLatitude'],
      )
    }

    if (['mp4', 'mov'].includes(extension)) {
      assert.equal(after['QuickTime:CreateDate'], '2026:04:30 07:53:02')

      assert.equal(after['Keys:CreationDate'], '2026:04:30 09:53:02+02:00')
    }
  }
}
catch (error) {
  if (error.code === 'ENOENT') {
    console.log(
      'Native ExifTool not installed; worker metadata read-back already passed.',
    )
  }
  else {
    throw error
  }
}

const ffmpeg = process.env.FFMPEG

if (ffmpeg) {
  // The upstream minimal HEIC exercises metadata structure, not a decodable image.
  // The separate synthetic HEIC above must pass full pixel-preservation checks.
  for (const { filename, extension } of generated.filter(
    item => item.extension !== 'heic-metadata',
  )) {
    /** Compare decoded pixels in order; remuxing can normalize packet timestamps and time bases. */
    const hash = file =>
      execFileSync(
        ffmpeg,
        [
          '-v',
          'error',
          '-i',
          file,
          '-map',
          '0:v:0',
          '-fps_mode',
          'passthrough',
          '-f',
          'framemd5',
          '-',
        ],
        {
          encoding: 'utf8',
        },
      ).split('\n')

    /** Keep decoded format, frame count, byte sizes and checksums; exclude container timing fields. */
    const payload = (file) => {
      const lines = hash(file).filter(Boolean)

      return {
        format: lines.filter(
          line => line.startsWith('#') && !/^#(?:tb|software)/.test(line),
        ),
        frames: lines
          .filter(line => !line.startsWith('#'))
          .map(line =>
            line
              .split(',')
              .slice(-2)
              .map(value => value.trim()),
          ),
      }
    }

    assert.deepEqual(
      payload(
        inputs.has(extension)
          ? join(directory, `original.${extension}`)
          : `tests/fixtures/sample.${extension}`,
      ),
      payload(join(directory, filename)),
      `Decoded ${extension} media changed`,
    )
  }
}

console.log(
  'Actual bundled WASM worker: JPEG/PNG/TIFF/HEIC photo metadata and MP4/MOV/MKV/WebM creation dates and unchanged encoded audio/video passed.',
)

console.log('Sample output:', directory)
