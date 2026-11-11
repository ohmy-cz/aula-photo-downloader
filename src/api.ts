import type { GalleryClientOptions } from './api/client'
import type { Media } from './types'
import {
  createGalleryClient,

  personalAlbumTitle,
} from './api/client'
import { mapV25Media } from './api/v25'
import { sleep } from './async'
import { CONFIG } from './config'
import { AppError } from './errors'
import { captureFor } from './metadata/dates'
import { validDay } from './security'

/** Map the versioned wire contract to a stable internal DTO and capture plan. */
export const parseMedia = (
  value: unknown,
  position: number,
  order: 'asc' | 'desc',
): Media => {
  const source = mapV25Media(value)

  return {
    ...source,
    position,
    order,
    capture: captureFor(source.filename, source.day, position, order),
  }
}

/** Traverse inclusive date bounds; probe newer versions only after an endpoint is retired or removed. */
export const collect = async (
  value: string,
  options: GalleryClientOptions & {
    cutoff: string | null
    until?: string
    onAlbum?: (name: string) => void | Promise<void>
    onMedia: (media: Media) => void | Promise<void>
    progress?: (count: number) => void
    delay?: number
  },
): Promise<void> => {
  if (options.cutoff !== null && !validDay(options.cutoff)) {
    throw new AppError('cutoff-invalid')
  }

  if (options.until !== undefined && !validDay(options.until)) {
    throw new AppError('upper-invalid')
  }

  if (options.cutoff !== null && options.until !== undefined && options.cutoff > options.until) {
    throw new AppError('range-reversed')
  }

  const client = createGalleryClient(value, options)

  const { url } = client

  const seen = new Set<number>()

  let index = 0

  let pages = 0

  let repeated = 0

  for (;;) {
    options.signal.throwIfAborted()

    if (
      ++pages > CONFIG.limits.collectionPages
      || index > CONFIG.limits.collectionItems
    ) {
      throw new AppError('api-pagination')
    }

    options.progress?.(index)

    const data = await client.readPage(index)

    if (index === 0 && options.onAlbum) {
      const album
        = data.album && typeof data.album === 'object' ? data.album : null

      const name = album?.name ?? album?.title

      const personalTitle
        = !(typeof name === 'string' && name.trim())
          && url.searchParams.get('userSpecificAlbum') === 'true'
          ? await personalAlbumTitle(
              url,
              options.signal,
              options.fetch ?? fetch,
            )
          : undefined

      await options.onAlbum(
        typeof name === 'string' && name.trim()
          ? name
          : url.searchParams.get('userSpecificAlbum') === 'true'
            ? (personalTitle ?? CONFIG.aula.myMediaName)
            : `Album ${String(url.searchParams.get('albumId'))}`,
      )
    }

    // Aula totals can be stale; only an empty page or a date boundary finishes collection.
    if (data.results.length === 0) {
      return
    }

    // Repeated or alternating pages that add no IDs cannot make progress.
    repeated = data.results.some(item => !seen.has(item.id))
      ? 0
      : repeated + 1

    if (repeated >= CONFIG.aula.maxRepeatedPages) {
      throw new AppError('api-pagination')
    }

    for (const [offset, item] of data.results.entries()) {
      options.signal.throwIfAborted()

      const media = parseMedia(
        item,
        index + offset + 1,
        url.searchParams.get('orderDirection') as 'asc' | 'desc',
      )

      const duplicate = seen.has(media.id)

      seen.add(media.id)

      if (seen.size > CONFIG.limits.collectionItems) {
        throw new AppError('api-pagination')
      }

      if (options.cutoff !== null && media.day !== null && media.day < options.cutoff) {
        if (media.order === 'desc') {
          return
        }

        continue
      }

      if (options.until !== undefined && media.day !== null && media.day > options.until) {
        if (media.order === 'asc') {
          return
        }

        continue
      }

      if (duplicate) {
        continue
      }

      await options.onMedia(media)
    }

    index += data.results.length

    await sleep(
      options.delay
      ?? CONFIG.timing.pageDelayMinMs
      + Math.floor(
        Math.random()
        * (CONFIG.timing.pageDelayMaxMs - CONFIG.timing.pageDelayMinMs + 1),
      ),
      options.signal,
    )
  }
}

/**
 * Collect a complete selected batch before allowing processing. The queue owns
 * signed URLs and child tags only in memory; failed or stopped collection never
 * returns a partial batch. Each run computes its capture plan from the current selection.
 */
export const collectMediaQueue = async (
  value: string,
  options: Omit<Parameters<typeof collect>[1], 'onMedia'> & {
    onCollected: (count: number) => void
  },
): Promise<Media[]> => {
  const media: Media[] = []

  let bytes = 0

  await collect(value, {
    ...options,
    onMedia: (item) => {
      bytes += new TextEncoder().encode(JSON.stringify(item)).byteLength

      if (bytes > CONFIG.limits.collectionBytes) {
        throw new AppError('collection-limit')
      }

      media.push(item)

      options.onCollected(media.length)
    },
  })

  options.signal.throwIfAborted()

  return media
}
