import type { Media } from '../types'
import { cleanNames } from '../security'
import { stamp } from './dates'

export type Metadata = Record<string, unknown>

/**
 * Build ExifTool arguments for the planned capture time without replacing
 * unrelated metadata. Photo child tags are merged with existing keywords;
 * XMP preserves the Copenhagen offset.
 *
 * @throws When the media is not a photo or has no valid capture plan.
 */
export const metadataArgs = (media: Media, existing: Metadata): string[] => {
  if (media.kind !== 'photo' || !media.capture) {
    throw new Error('No valid capture date is available.')
  }

  const c = media.capture

  const local = stamp(c)

  const zoned = local + c.offset

  const args = [
    `-XMP-exif:DateTimeOriginal=${zoned}`,
    `-XMP-xmp:CreateDate=${zoned}`,
    `-XMP-exif:DateTimeDigitized=${zoned}`,
  ]

  args.push(
    `-EXIF:DateTimeOriginal=${local}`,
    `-EXIF:CreateDate=${local}`,
    `-EXIF:OffsetTimeOriginal=${c.offset}`,
    `-EXIF:OffsetTimeDigitized=${c.offset}`,
    '-EXIF:SubSecTimeOriginal=',
    '-EXIF:SubSecTimeDigitized=',
  )

  const type
    = typeof existing['File:FileType'] === 'string'
      ? existing['File:FileType']
      : ''

  const fields = [
    'XMP-dc:Subject',
    'XMP-iptcExt:PersonInImage',
    ...(['JPEG', 'TIFF'].includes(type) ? ['IPTC:Keywords'] : []),
  ]

  for (const field of fields) {
    if (!media.children.length) {
      continue
    }

    const current = existing[field]

    const values: unknown[] = Array.isArray(current)
      ? current
      : typeof current === 'string'
        ? [current]
        : []

    const names = cleanNames([...values, ...media.children])

    args.push(`-${field}=`)

    for (const name of names) {
      args.push(`-${field}+=${name}`)
    }
  }

  if (type === 'JPEG' || type === 'TIFF') {
    args.push('-IPTC:CodedCharacterSet=UTF8')
  }

  return args
}
