import type { State } from '../types'
import { z } from 'zod'
import { CONFIG } from '../config'
import { AppError } from '../errors'
import { latestPhotoDate, writableAlbums } from './client'
import { ApiKey, Destination, immichPermission, immichUrl } from './contracts'
import { connectionStatus, requireConnection, saveConnection } from './settings'

/** Keep credentials and connection changes in the options page; album selection exposes only safe DTOs to an activated Aula tab. */
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

      return { connected: false, server: '' }
    }

    const server = immichUrl(z.string().parse(message.server))

    const connection = { id: crypto.randomUUID(), server, apiKey: ApiKey.parse(message.apiKey), lastAlbumId: null }

    if (!await chrome.permissions.contains({ origins: [immichPermission(server)] })) {
      throw new AppError('immich-config')
    }

    await writableAlbums(connection)

    await saveConnection(connection)

    return { connected: true, server }
  }

  if (!settings && message.type === 'immich-albums') {
    const connection = await requireConnection()

    const albums = await writableAlbums(connection)

    return { albums, connectionId: connection.id, selectedId: albums.find(album => album.id === connection.lastAlbumId)?.id ?? albums[0]?.id ?? null }
  }

  if (!settings && message.type === 'immich-select') {
    if (state.run) {
      throw new AppError('worker-busy')
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
