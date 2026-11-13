import type { State } from '../types'
import { z } from 'zod'
import { CONFIG } from '../config'
import { AppError } from '../errors'
import { albumThumbnail, createAlbum, latestPhotoDate, writableAlbums } from './client'
import { ApiKey, Destination, immichPermission, immichUrl } from './contracts'
import { connectionStatus, loadConnection, requireConnection, saveConnection } from './settings'

/** Read previews independently of the mutation queue, bound to the saved connection selected by an activated tab. */
export const handleThumbnailRequest = async (message: Record<string, unknown>) => {
  const connection = await requireConnection(Destination.parse(message.destination))

  return albumThumbnail(connection, z.uuid().parse(message.assetId))
}

/** Keep credentials in the background; omitted/masked keys preserve the same server's connection, and content receives only album DTOs. */
export const handleImmichRequest = async (state: State, message: Record<string, unknown>, settings: boolean) => {
  if (settings && message.type === 'immich-status') {
    return connectionStatus()
  }

  if (settings && ['immich-connect', 'immich-disconnect'].includes(String(message.type))) {
    if (state.run) {
      throw new AppError('worker-busy')
    }

    if (message.type === 'immich-disconnect') {
      await chrome.storage.local.remove(CONFIG.immich.storageKey)

      return { connected: false, server: '', keyLength: 0 }
    }

    const server = immichUrl(z.string().parse(message.server))

    const keepKey = message.apiKey === undefined || (typeof message.apiKey === 'string' && /^\*+$/.test(message.apiKey))

    const connection = keepKey
      ? await loadConnection()
      : { id: crypto.randomUUID(), server, apiKey: ApiKey.parse(message.apiKey), lastAlbumId: null }

    if (!connection || connection.server !== server || !await chrome.permissions.contains({ origins: [immichPermission(server)] })) {
      throw new AppError('immich-config')
    }

    await writableAlbums(connection)

    await saveConnection(connection)

    return { connected: true, server, keyLength: connection.apiKey.length }
  }

  if (!settings && message.type === 'immich-albums') {
    const connection = await requireConnection()

    const albums = await writableAlbums(connection)

    return { albums, connectionId: connection.id, selectedId: albums.find(album => album.id === connection.lastAlbumId)?.id ?? albums[0]?.id ?? null }
  }

  if (!settings && ['immich-select', 'immich-create-album'].includes(String(message.type))) {
    if (state.run) {
      throw new AppError('worker-busy')
    }

    if (message.type === 'immich-create-album') {
      const connection = await requireConnection({ connectionId: z.uuid().parse(message.connectionId) })

      return createAlbum(connection, z.string().parse(message.name))
    }

    const destination = Destination.parse(message.destination)

    const connection = await requireConnection(destination)

    if (!(await writableAlbums(connection)).some(album => album.id === destination.albumId)) {
      throw new AppError('immich-album')
    }

    const latestPhotoAt = await latestPhotoDate(connection, destination.albumId)

    await saveConnection({ ...connection, lastAlbumId: destination.albumId })

    return { ...destination, latestPhotoAt }
  }

  throw new AppError('operation')
}
