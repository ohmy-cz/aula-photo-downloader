import type { Media } from '../types'
import type { ProcessedMedia } from './formats'
import type { Metadata } from './plan'
import { parseMetadata, writeMetadata } from '@colorhythm/exiftool-wasm'
import { CONFIG } from '../config'
import { required } from '../required'
import { cleanNames } from '../security'
import { stamp } from './dates'
import { MEDIA_MIME } from './formats'
import { metadataArgs } from './plan'

const readArgs = [
  '-j',
  '-G1',
  '-s',
  '-api',
  'QuickTimeUTC=0',
  '-api',
  'IgnoreTags=all',
  '-m',
  '-q',
  '-FileType',
  '-XMP-exif:DateTimeOriginal',
  '-ExifIFD:DateTimeOriginal',
  '-ExifIFD:OffsetTimeOriginal',
  '-XMP-dc:Subject',
  '-XMP-iptcExt:PersonInImage',
  '-IPTC:Keywords',
  '-GPS:all',
  '-XMP-exif:GPS*',
]

/** Bound JSON metadata before parsing; unrelated text and binary tags are never requested. */
const decodeMetadata = (json: string): Metadata[] => {
  if (new TextEncoder().encode(json).byteLength > CONFIG.limits.metadataBytes) {
    throw new Error('Photo metadata exceeds the processing limit.')
  }

  return JSON.parse(json) as Metadata[]
}

/**
 * Reject output that lost required capture dates, photo child tags, existing
 * keywords, or GPS fields. Validation failure rejects the download.
 *
 * @throws When read-back metadata does not satisfy the capture plan.
 */
const verify = (media: Media, before: Metadata, after: Metadata): void => {
  const capture = required(media.capture)

  const expected = stamp(capture) + capture.offset

  if (after['XMP-exif:DateTimeOriginal'] !== expected) {
    throw new Error('Capture date verification failed.')
  }

  if (
    after['ExifIFD:DateTimeOriginal'] !== stamp(capture)
    || after['ExifIFD:OffsetTimeOriginal'] !== capture.offset
  ) {
    throw new Error('EXIF date verification failed.')
  }

  const fields = [
    'XMP-dc:Subject',
    'XMP-iptcExt:PersonInImage',
    ...(['JPEG', 'TIFF'].includes(String(before['File:FileType']))
      ? ['IPTC:Keywords']
      : []),
  ]

  for (const field of fields) {
    const names = cleanNames(
      Array.isArray(after[field]) ? after[field] : [after[field]],
    )

    for (const name of media.children) {
      if (!names.includes(name)) {
        throw new Error('Child tag verification failed.')
      }
    }

    const original = cleanNames(
      Array.isArray(before[field]) ? before[field] : [before[field]],
    )

    if (original.some(name => !names.includes(name))) {
      throw new Error('Existing tag was lost.')
    }
  }

  for (const [key, value] of Object.entries(before)) {
    if (
      /^(?:GPS:|XMP-exif:GPS)/.test(key)
      && JSON.stringify(after[key]) !== JSON.stringify(value)
    ) {
      throw new Error('GPS preservation verification failed.')
    }
  }
}

/**
 * Read, update, and verify a supported photo with the bundled ExifTool WASM.
 * Callers must serialize jobs in a dedicated worker because the library shares
 * buffers, and must dispose the runtime after processing.
 *
 * @param media The photo and capture metadata to apply.
 * @param bytes Original photo contents.
 * @param fetchWasm Optional fetch override for the locally packaged WASM asset.
 * @returns Verified bytes with the MIME type determined from the original file.
 * @throws On unsupported formats or failed metadata reading, writing, or verification.
 */
export const processBytes = async (
  media: Media,
  bytes: Uint8Array,
  fetchWasm?: typeof fetch,
): Promise<ProcessedMedia> => {
  if (media.kind !== 'photo') {
    throw new Error('ExifTool browser processing supports photos only.')
  }

  // The library uses shared buffers: callers must serialize operations in one worker.
  const options = fetchWasm
    ? { fetch: fetchWasm as (...args: unknown[]) => Promise<Response> }
    : {}

  const file = {
    name: `input${/\.[a-z0-9]{1,8}$/i.exec(media.filename)?.[0] ?? '.bin'}`,
    data: bytes,
  }

  const read = await parseMetadata<Metadata[]>(file, {
    ...options,
    args: readArgs,
    transform: decodeMetadata,
  })

  if (!read.success || !read.data[0]) {
    throw new Error('Could not read the original metadata.')
  }

  const before = read.data[0]

  const type = String(before['File:FileType'])

  if (!['JPEG', 'PNG', 'TIFF', 'HEIC', 'HEIF'].includes(type)) {
    throw new Error('Unsupported metadata format.')
  }

  const result = await writeMetadata(
    file,
    {},
    { ...options, args: [...metadataArgs(media, before), '-m', '-q'] },
  )

  if (!result.success || !result.data.byteLength || result.data.byteLength > CONFIG.limits.mediaBytes) {
    throw new Error('Browser metadata writing failed.')
  }

  const after = await parseMetadata<Metadata[]>(
    { name: file.name, data: new Uint8Array(result.data) },
    { ...options, args: readArgs, transform: decodeMetadata },
  )

  if (!after.success || !after.data[0]) {
    throw new Error('Processed file verification failed.')
  }

  verify(media, before, after.data[0])

  return {
    bytes: result.data,
    mime: MEDIA_MIME[type as keyof typeof MEDIA_MIME],
  }
}
