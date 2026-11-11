import { CONFIG, defaultGalleryUrl } from '../config'
import { AppError } from '../errors'
import { required } from '../required'
import { API_VERSION } from './contracts'

/** Empty query parameters use the same defaults as absent parameters. */
const parameter = (url: URL, key: string, fallback: string): string => {
  const value = url.searchParams.get(key)

  return value === null || value === '' ? fallback : value
}

/** Accept only read-only gallery parameters and current/newer version hints; restart pagination from zero. */
export const apiUrl = (value: string): URL => {
  const url = new URL(value.replace(/&amp;/g, '&'))

  if (
    url.origin !== CONFIG.aula.origin
    || url.username
    || url.password
    || url.hash
    || !/^\/api\/v\d+\/?$/.test(url.pathname)
    || url.searchParams.getAll('method').length !== 1
    || url.searchParams.get('method') !== CONFIG.aula.mediaMethod
  ) {
    throw new Error('Invalid Aula gallery request.')
  }

  const version = Number(required(/\d+/.exec(url.pathname))[0])

  if (
    CONFIG.aula.apiVersion !== API_VERSION
    || !Number.isSafeInteger(version)
    || version < API_VERSION
  ) {
    throw new AppError('api-version')
  }

  const limit = Number(
    parameter(url, 'limit', String(CONFIG.aula.defaultPageSize)),
  )

  const order = parameter(url, 'orderDirection', CONFIG.aula.defaultOrder)

  if (
    !Number.isInteger(limit)
    || limit < 1
    || limit > CONFIG.aula.maxPageSize
    || !['asc', 'desc'].includes(order)
    || (url.searchParams.has('sortOn')
      && url.searchParams.get('sortOn') !== CONFIG.aula.defaultSort)
  ) {
    throw new Error('Unsupported gallery order.')
  }

  url.searchParams.set(
    'filterBy',
    parameter(url, 'filterBy', CONFIG.aula.defaultFilter),
  )

  url.searchParams.set('index', '0')

  url.searchParams.set('limit', String(limit))

  url.searchParams.set('sortOn', CONFIG.aula.defaultSort)

  url.searchParams.set('orderDirection', order)

  // The API does not need authentication tokens or arbitrary unrelated parameters.
  for (const key of [...url.searchParams.keys()]) {
    if (
      ![
        'method',
        'userSpecificAlbum',
        'albumId',
        'index',
        'limit',
        'sortOn',
        'orderDirection',
        'filterBy',
        'filterInstProfileIds[]',
      ].includes(key)
    ) {
      url.searchParams.delete(key)
    }
  }

  return url
}

/** Resolve the active gallery/filter from recent requests without reading or driving its UI. */
export const currentGallery = (
  page: string,
  entries: PerformanceResourceTiming[],
  saved?: { page: string, url: string },
): string => {
  const location = new URL(page)

  const route = location.hash.split('?')[0] ?? ''

  if (
    location.origin !== CONFIG.aula.origin
    || !/^#\/galleri(?:\/|$)/.test(route)
  ) {
    throw new AppError('gallery-open')
  }

  const mine = route === CONFIG.aula.myMediaRoute

  const album = /\/(\d+)$/.exec(route)?.[1]

  if (!mine && album === undefined) {
    throw new AppError('album-open')
  }

  /** Match this route's gallery identity while preserving any profile filters carried by the candidate request. */
  const matches = (url: URL) =>
    mine
      ? url.searchParams.get('userSpecificAlbum') === 'true'
      && !url.searchParams.has('albumId')
      : url.searchParams.get('albumId') === album

  for (const entry of [...entries].reverse()) {
    try {
      const url = apiUrl(entry.name)

      if (matches(url)) {
        return url.href
      }
    }
    catch {
      // Ignore requests that are not approved gallery candidates.
    }
  }

  if (saved?.page === page) {
    try {
      const url = apiUrl(saved.url)

      if (matches(url)) {
        return url.href
      }
    }
    catch {
      // Ignore requests that are not approved gallery candidates.
    }
  }

  if (mine) {
    return apiUrl(defaultGalleryUrl()).href
  }

  throw new AppError('album-load')
}

/** Canonical gallery/filter identity is independent of API version, page size and sort order. */
export const galleryKey = async (value: string): Promise<string> => {
  const url = apiUrl(value)

  for (const key of ['index', 'limit', 'orderDirection', 'sortOn']) {
    url.searchParams.delete(key)
  }

  if (url.searchParams.get('filterBy') === CONFIG.aula.defaultFilter) {
    url.searchParams.delete('filterBy')
  }

  const pairs = [...url.searchParams].sort(
    ([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv),
  )

  const normalized = JSON.stringify([`${url.origin}/gallery`, pairs])

  return Array.from(new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(normalized),
    ),
  ), b => b.toString(16).padStart(2, '0'))
    .join('')
}

/** Recognize album routes without requesting Aula data or reading another site's content. */
export const isAlbumPage = (value: string): boolean => {
  try {
    const url = new URL(value)

    return (
      url.origin === CONFIG.aula.origin
      && /^#\/galleri\/(?:minemedier|(?:[^/?]+\/)*\d+)\/?$/.test(
        url.hash.split('?')[0] ?? '',
      )
    )
  }
  catch {
    return false
  }
}
