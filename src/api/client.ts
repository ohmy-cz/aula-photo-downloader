import type { AulaV25Page } from './contracts'
import { CONFIG } from '../config'
import { AppError } from '../errors'
import { required } from '../required'
import { readBytes } from '../streams'
import { API_VERSION } from './contracts'
import { apiUrl } from './gallery'
import { decodeV25Albums, decodeV25Page } from './v25'

export interface GalleryClientOptions {
  signal: AbortSignal
  onApiVersion?: (version: number) => void
  fetch?: typeof fetch
}

/** Fetch only caller-validated Aula URLs with the shared credential, redirect and timeout policy. */
const fetchAula = async (
  url: URL,
  signal: AbortSignal,
  fetchPage: typeof fetch,
): Promise<Response> =>
  fetchPage(url.href, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.any([
      signal,
      AbortSignal.timeout(CONFIG.timing.apiRequestMs),
    ]),
    redirect: 'error',
  })

/** Bound streamed API responses before parsing; signed URLs are retained only in memory. */
const readPayload = async (response: Response): Promise<unknown> => {
  const bytes = await readBytes(
    response,
    CONFIG.limits.apiResponseBytes,
    'api-contract',
    'api-contract',
  )

  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  }
  catch {
    throw new AppError('api-contract')
  }
}

/** Resolve the personal gallery's null-ID title from Aula's album list using the same profile filters. */
export const personalAlbumTitle = async (
  mediaRequest: URL,
  signal: AbortSignal,
  fetchPage: typeof fetch,
): Promise<string | undefined> => {
  const url = new URL(mediaRequest.origin + mediaRequest.pathname)

  for (const [key, value] of mediaRequest.searchParams) {
    if (['filterBy', 'filterInstProfileIds[]'].includes(key)) {
      url.searchParams.append(key, value)
    }
  }

  url.searchParams.set('method', CONFIG.aula.albumsMethod)

  url.searchParams.set('index', '0')

  url.searchParams.set('limit', String(CONFIG.aula.defaultPageSize))

  url.searchParams.set('sortOn', CONFIG.aula.albumsSort)

  url.searchParams.set('orderDirection', CONFIG.aula.defaultOrder)

  try {
    const response = await fetchAula(url, signal, fetchPage)

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined)

      return undefined
    }

    return decodeV25Albums(
      await readPayload(response),
      Number(required(/\d+/.exec(url.pathname))[0]),
    ).find(album => album.id === null)?.title
  }
  catch {
    // Naming is optional; cancellation still stops the collection, and media errors remain authoritative.
    signal.throwIfAborted()

    return undefined
  }
}

/** Own version negotiation for one collection; all accepted pages retain the implemented DTO contract. */
export const createGalleryClient = (
  value: string,
  options: GalleryClientOptions,
) => {
  const url = apiUrl(value)

  const observedVersion = Number(required(/\d+/.exec(url.pathname))[0])

  let version = API_VERSION

  let versionProbes = 0

  /** Bound version probes across the whole collection and validate each page before exposing any media. */
  const readPage = async (index: number): Promise<AulaV25Page['data']> => {
    url.searchParams.set('index', String(index))

    for (;;) {
      options.signal.throwIfAborted()

      url.pathname = `/api/v${String(version)}/`

      const response = await fetchAula(
        url,
        options.signal,
        options.fetch ?? fetch,
      )

      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)

        if (response.status === 404 || response.status === 410) {
          if (versionProbes >= CONFIG.aula.maxApiVersionProbes) {
            throw new AppError('api-version')
          }

          versionProbes++

          version = Math.max(version + 1, observedVersion)

          continue
        }

        throw new AppError(
          response.status === 401 || response.status === 403
            ? 'api-login'
            : 'api-unavailable',
        )
      }

      const page = decodeV25Page(await readPayload(response), index, version)

      options.onApiVersion?.(version)

      return page.data
    }
  }

  return { url, readPage }
}
