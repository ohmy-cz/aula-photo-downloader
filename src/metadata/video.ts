import type { FFmpegCoreModule, FFmpegCoreModuleFactory } from '@ffmpeg/types'
import type { Media } from '../types'
import type { ProcessedMedia } from './formats'
import { CONFIG } from '../config'
import { MEDIA_MIME } from './formats'

interface Probe {
  format: { format_name: string, tags?: Record<string, string> }
  streams: {
    codec_type: string
    codec_name: string
    width?: number
    height?: number
    channels?: number
    sample_rate?: string
    disposition?: Record<string, number>
    side_data_list?: unknown[]
    tags?: Record<string, string>
  }[]
}

/** Run a local-only command and reject all failures, including timeouts. */
const execute = (
  core: FFmpegCoreModule,
  args: string[],
  probe = false,
): void => {
  core.reset()

  core.setTimeout(CONFIG.timing.processingMs)

  const report = { failed: false }

  core.setLogger(({ type }) => {
    if (probe && type === 'stderr') {
      report.failed = true
    }
  })

  const status = probe ? core.ffprobe(...args) : core.exec(...args)

  // The pinned core leaves ret at -1 after successful ffprobe calls.
  // Require error-free probing and a fresh, complete JSON report below.
  if ((status !== 0 && !(probe && status === -1)) || report.failed) {
    throw new Error('Video metadata processing failed.')
  }
}

/** Choose only supported container demuxers, rather than probing unrelated formats. */
const demuxer = (name: string): string =>
  /\.(?:mp4|mov)$/i.test(name) ? 'mov' : 'matroska'

/** Probe embedded dates and stream identities without decoding or accessing external resources. */
const inspect = (core: FFmpegCoreModule, name: string): Probe => {
  try {
    core.FS.unlink('probe.json')
  }
  catch {
    // The first probe has no report to remove.
  }

  execute(
    core,
    [
      '-v',
      'error',
      '-protocol_whitelist',
      'file',
      '-f',
      demuxer(name),
      '-nofind_stream_info',
      '-show_format',
      '-show_streams',
      '-of',
      'json',
      '-o',
      'probe.json',
      name,
    ],
    true,
  )

  return JSON.parse(
    core.FS.readFile('probe.json', { encoding: 'utf8' }) as string,
  ) as Probe
}

/** Hash encoded audio/video payloads, excluding container timestamps and metadata. */
const streamHash = (core: FFmpegCoreModule, name: string): string => {
  execute(core, [
    '-v',
    'error',
    '-protocol_whitelist',
    'file',
    '-f',
    demuxer(name),
    '-nofind_stream_info',
    '-i',
    name,
    '-map',
    '0:v?',
    '-map',
    '0:a?',
    '-c',
    'copy',
    '-f',
    'streamhash',
    '-hash',
    'sha256',
    'hash.txt',
  ])

  return core.FS.readFile('hash.txt', { encoding: 'utf8' }) as string
}

/** Preserve stream dimensions, audio layout, dispositions and display matrices alongside codec identities. */
const streamIdentity = (stream: Probe['streams'][number]) => [
  stream.codec_type,
  stream.codec_name,
  stream.width,
  stream.height,
  stream.channels,
  stream.sample_rate,
  stream.disposition,
  stream.side_data_list,
]

/**
 * Remux MP4/MOV/MKV/WebM with a UTC capture timestamp using packaged FFmpeg.wasm.
 * All streams are explicitly copied; unsupported streams or failed date/payload
 * verification reject the download. No codecs are used to re-encode.
 * The caller owns the dedicated worker and must terminate it to release WASM memory.
 */
export const processVideo = async (
  media: Media,
  bytes: Uint8Array,
): Promise<ProcessedMedia> => {
  if (!media.capture) {
    throw new Error('No capture date available.')
  }

  const extension = /\.(mp4|mov|mkv|webm)$/i
    .exec(media.filename)?.[1]
    ?.toLowerCase()

  if (extension === undefined || extension === '') {
    throw new Error('Unsupported video container.')
  }

  const root = new URL('../', import.meta.url)

  const coreURL = new URL(CONFIG.browser.ffmpegCoreAsset, root).href

  const wasmURL = new URL(CONFIG.browser.ffmpegWasmAsset, root).href

  const { default: createCore } = (await import(coreURL)) as {
    default: FFmpegCoreModuleFactory
  }

  const core = await createCore({
    mainScriptUrlOrBlob: `${coreURL}#${btoa(JSON.stringify({ wasmURL }))}`,
  })

  const input = `input.${extension}`

  const output = `output.${extension}`

  try {
    core.FS.writeFile(input, bytes)

    const before = inspect(core, input)

    const isQuickTime = extension === 'mp4' || extension === 'mov'

    const detected = before.format.format_name.split(',')

    if (
      !(isQuickTime
        ? detected.includes('mov')
        : detected.includes('matroska'))
      || !before.streams.some(stream => stream.codec_type === 'video')
    ) {
      throw new Error('Unsupported video container.')
    }

    const utc
      = `${media.capture.utc.replace(/^(\d{4}):(\d{2}):(\d{2}) /, '$1-$2-$3T')}Z`

    const zoned = `${media.capture.day}T${media.capture.time}${media.capture.offset}`

    const originalHash = streamHash(core, input)

    execute(core, [
      '-v',
      'error',
      '-protocol_whitelist',
      'file',
      '-f',
      demuxer(input),
      '-nofind_stream_info',
      '-i',
      input,
      '-map',
      '0',
      '-map_metadata',
      '0',
      '-map_chapters',
      '0',
      '-c',
      'copy',
      '-metadata',
      `creation_time=${utc}`,
      '-metadata:s',
      `creation_time=${utc}`,
      ...(isQuickTime
        ? [
            '-movflags',
            'use_metadata_tags',
            '-metadata',
            `com.apple.quicktime.creationdate=${zoned}`,
          ]
        : []),
      '-f',
      extension === 'mkv' ? 'matroska' : extension,
      output,
    ])

    const after = inspect(core, output)

    const expected = Date.parse(utc)

    /** Compare embedded timestamps as UTC instants, allowing different offset spellings. */
    const sameDate = (value: string | undefined) =>
      value !== undefined && Date.parse(value) === expected

    if (
      !sameDate(after.format.tags?.creation_time)
      || (isQuickTime
        && !sameDate(after.format.tags?.['com.apple.quicktime.creationdate']))
      || JSON.stringify(before.streams.map(streamIdentity))
      !== JSON.stringify(after.streams.map(streamIdentity))
      || (isQuickTime
        && after.streams.some(
          stream => !sameDate(stream.tags?.creation_time),
        ))
        || originalHash !== streamHash(core, output)
    ) {
      throw new Error('Video metadata verification failed.')
    }

    const data = core.FS.readFile(output, { encoding: 'binary' }) as Uint8Array

    return {
      bytes: new Uint8Array(data).buffer,
      mime: MEDIA_MIME[
        extension.toUpperCase() as 'MP4' | 'MOV' | 'MKV' | 'WEBM'
      ],
    }
  }
  finally {
    for (const name of [input, output, 'probe.json', 'hash.txt']) {
      try {
        core.FS.unlink(name)
      }
      catch {
        // A failed command may not have created its output.
      }
    }
  }
}
