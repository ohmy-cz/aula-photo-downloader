import { CONFIG } from './config'

/** Require a non-null, non-array object at message boundaries; callers validate its fields separately. */
export const object = (value: unknown): Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid response.')
  }

  return value as Record<string, unknown>
}

/**
 * Validate an exact calendar day, rejecting dates JavaScript would normalize
 * into another month instead of treating as invalid.
 */
export const validDay = (value: unknown): value is string => {
  return (
    typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(Date.parse(`${value}T12:00:00Z`))
    && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value
  )
}

/** Signed originals must match the configured HTTPS origin, including its port; playlists are not archival files. */
export const mediaUrl = (value: unknown): URL => {
  if (
    typeof value !== 'string'
    || value.length > CONFIG.limits.mediaUrlCharacters
  ) {
    throw new Error('Missing original URL.')
  }

  const url = new URL(value)

  if (
    url.protocol !== 'https:'
    || url.origin !== CONFIG.aula.mediaOrigin
    || url.username
    || url.password
    || url.hash
  ) {
    throw new Error('Unexpected original URL.')
  }

  if (/\.(?:m3u8|mpd)$/i.test(url.pathname)) {
    throw new Error('A video playlist is not an original.')
  }

  return url
}

/** Keep filenames flat, portable and short enough for Windows and Chrome download paths. */
export const safeName = (value: unknown): string => {
  let name
    = typeof value === 'string' ? value.normalize('NFC').trim() : 'original'

  name = name
    .replace(/[\p{Cc}/\\:*?"<>|]/gu, '_')
    .replace(/^[.\s-]+/, '_')
    .replace(/[.\s]+$/, '')

  const extension = /\.[a-z0-9]{1,8}$/i.exec(name)?.[0] ?? ''

  let stem = name.slice(0, name.length - extension.length)

  if (new TextEncoder().encode(stem).length > CONFIG.limits.filenameStemBytes) {
    const segments = Array.from(
      new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(stem),
      part => part.segment,
    )

    do {
      segments.pop()

      stem = segments.join('')
    } while (
      new TextEncoder().encode(stem).length > CONFIG.limits.filenameStemBytes
    )
  }

  name = stem + extension

  if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)) {
    name = `_${name}`
  }

  return name || 'original'
}

/** Remove control characters and duplicates without changing human names or group suffixes. */
export const cleanNames = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return []
  }

  return [
    ...new Set(
      value
        .filter((v): v is string => typeof v === 'string')
        .map(v =>
          v
            .normalize('NFC')
            .replace(/\p{Cc}/gu, ' ')
            .replace(/\s+/g, ' ')
            .trim(),
        )
        .filter(Boolean),
    ),
  ]
}

/** Reject untrusted gallery identities before they become storage dictionary keys. */
export const validateKey: (value: unknown) => asserts value is string = (
  value,
) => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error('Invalid gallery.')
  }
}

/** Validate an actual flat browser filename without truncating collision suffixes or current receipts. */
export const storedName = (value: unknown): value is string =>
  typeof value === 'string'
  && value.length > 0
  && new TextEncoder().encode(value).length <= 255
  && !/[\p{Cc}/\\:*?"<>|]/u.test(value)
  && !/^[.\s-]|[.\s]$/.test(value)
  && !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(value)

/** Keep media names inert on disk, even when an upstream name has an executable extension. */
export const mediaName = (value: unknown): string => {
  const name = safeName(value)

  return /\.(?:jpe?g|png|tiff?|hei[cf]|gif|webp|bmp|avif|mp4|mov|mkv|webm)$/i.test(
    name,
  )
    ? name
    : safeName(`${name}.bin`)
}
