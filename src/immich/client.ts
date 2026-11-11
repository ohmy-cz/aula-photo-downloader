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

/** Send credentials only to the configured server, without cookies or redirects; bound every response before parsing. */
const api = async (connection: ImmichConnection, path: string, options: RequestInit = {}, upload = false): Promise<unknown> => {
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
    .map(album => ({ id: album.id, name: album.albumName }))
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
