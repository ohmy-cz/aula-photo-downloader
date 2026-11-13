import type { ProcessedMedia } from '../metadata/formats'
import type { Job } from '../types'
import type { ImmichAlbum, ImmichConnection } from './contracts'
import { z } from 'zod'
import { CONFIG } from '../config'
import { AppError } from '../errors'
import { mediaBlob } from '../metadata/formats'
import { required } from '../required'
import { readBytes } from '../streams'
import { Album, immichUrl } from './contracts'

const albumSummary = (album: z.infer<typeof Album>): ImmichAlbum => ({ id: album.id, name: album.albumName, thumbnailId: album.albumThumbnailAssetId })

/** Send credentials only to the configured server, without cookies or redirects; bound every response before parsing. */
const fetchResponse = async (connection: ImmichConnection, path: string, options: RequestInit = {}, upload = false): Promise<Response> => {
  let response: Response

  try {
    response = await fetch(`${immichUrl(connection.server)}/api/${path}`, {
      ...options,
      credentials: 'omit',
      redirect: 'error',
      headers: { 'Accept': 'application/json', 'x-api-key': connection.apiKey, ...options.headers },
      signal: AbortSignal.timeout(upload ? CONFIG.timing.immichUploadMs : CONFIG.timing.apiRequestMs),
    })
  }
  catch {
    throw new AppError('immich-unavailable')
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)

    throw new AppError([401, 403].includes(response.status) ? 'immich-auth' : 'immich-unavailable')
  }

  return response
}

/** Decode only bounded JSON responses after transport and authentication checks. */
const api = async (connection: ImmichConnection, path: string, options: RequestInit = {}, upload = false): Promise<unknown> => {
  const response = await fetchResponse(connection, path, options, upload)

  try {
    return JSON.parse(new TextDecoder().decode(await readBytes(response, CONFIG.limits.apiResponseBytes, 'immich-contract', 'immich-contract')))
  }
  catch {
    throw new AppError('immich-contract')
  }
}

/** Include owned and shared editor albums, newest first, using the authenticated user's role rather than album names. */
export const writableAlbums = async (connection: ImmichConnection): Promise<ImmichAlbum[]> => {
  const [user, albums] = await Promise.all([api(connection, 'users/me'), api(connection, 'albums')])

  const identity = z.object({ id: z.uuid() }).safeParse(user)

  const result = z.array(Album).max(CONFIG.limits.immichAlbums).safeParse(albums)

  if (!identity.success || !result.success) {
    throw new AppError('immich-contract')
  }

  return result.data
    .filter(album => album.albumUsers.some(member => member.user.id === identity.data.id && member.role !== 'viewer'))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id))
    .map(albumSummary)
}

/** Create an empty, private album; confirm and validate the response before exposing its identity. Never retry this mutation automatically. */
export const createAlbum = async (connection: ImmichConnection, name: string): Promise<ImmichAlbum> => {
  const albumName = z.string().trim().min(1).max(CONFIG.limits.nameCharacters).parse(name)

  const result = Album.safeParse(await api(connection, 'albums', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ albumName }),
  }))

  if (!result.success) {
    throw new AppError('immich-contract')
  }

  return albumSummary(result.data)
}

/** Return a bounded raster preview without exposing the server key, accepting remote URLs, following redirects or saving media. */
export const albumThumbnail = async (connection: ImmichConnection, assetId: string): Promise<{ src: string }> => {
  const response = await fetchResponse(connection, `assets/${z.uuid().parse(assetId)}/thumbnail?size=thumbnail`, {
    headers: { Accept: 'image/webp,image/jpeg,image/png' },
    cache: 'no-store',
  })

  const mime = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()

  if (!['image/webp', 'image/jpeg', 'image/png'].includes(mime ?? '')) {
    await response.body?.cancel()

    throw new AppError('immich-contract')
  }

  const bytes = await readBytes(response, CONFIG.limits.immichThumbnailBytes, 'immich-contract', 'immich-contract')

  let binary = ''

  for (let index = 0; index < bytes.length; index += 32768) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 32768))
  }

  return { src: `data:${mime};base64,${btoa(binary)}` }
}

/** Read the newest photo's authoritative capture instant, excluding trashed assets; an empty album has no cutoff. */
export const latestPhotoDate = async (connection: ImmichConnection, albumId: string): Promise<string | null> => {
  const result = z.object({ assets: z.object({ items: z.array(z.object({ type: z.literal('IMAGE'), fileCreatedAt: z.iso.datetime({ offset: true }) })).max(1) }) }).safeParse(await api(connection, 'search/metadata', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      size: 1,
      orderBy: { field: 'fileCreatedAt', direction: 'desc' },
      filter: { albumIds: { any: [z.uuid().parse(albumId)] }, type: { eq: 'IMAGE' }, trashedAt: { eq: null } },
    }),
  }))

  if (!result.success) {
    throw new AppError('immich-contract')
  }

  return result.data.assets.items[0]?.fileCreatedAt ?? null
}

/** Count an import only after upload and album assignment succeed; existing assets and duplicate membership are successful retries. */
export const importProcessed = async (connection: ImmichConnection, albumId: string, job: Job, output: ProcessedMedia): Promise<void> => {
  const capture = required(job.media.capture)

  const date = new Date(`${capture.day}T${capture.time}${capture.offset}`).toISOString()

  const body = new FormData()

  body.append('assetData', mediaBlob(output), job.filename)

  body.append('fileCreatedAt', date)

  body.append('fileModifiedAt', date)

  const asset = z.object({ id: z.uuid(), status: z.enum(['created', 'duplicate']) }).safeParse(await api(connection, 'assets', { method: 'POST', body }, true))

  if (!asset.success) {
    throw new AppError('immich-contract')
  }

  const membership = z.array(z.object({ id: z.uuid(), success: z.boolean(), error: z.string().optional() })).safeParse(await api(connection, `albums/${z.uuid().parse(albumId)}/assets`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: [asset.data.id] }),
  }))

  if (!membership.success || membership.data.length !== 1 || membership.data[0]?.id !== asset.data.id) {
    throw new AppError('immich-contract')
  }

  if (!membership.data[0].success && membership.data[0].error !== 'duplicate') {
    throw new AppError('immich-album')
  }
}
