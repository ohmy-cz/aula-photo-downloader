import { z } from 'zod'
import { CONFIG } from '../config'
import { AppError } from '../errors'

export const IMMICH_API_VERSION = '3.4.1'

/** Accept a user-selected HTTP(S) server, including reverse-proxy paths; credentials never belong in its URL. */
export const immichUrl = (value: string): string => {
  try {
    const url = new URL(value.trim())

    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || value.length > CONFIG.limits.mediaUrlCharacters) {
      throw new Error('Invalid server URL')
    }

    return `${url.origin}${url.pathname.replace(/\/+$/, '').replace(/\/api$/, '')}`
  }
  catch {
    throw new AppError('immich-config')
  }
}

export const immichPermission = (server: string): string => `${new URL(immichUrl(server)).origin}/*`

export const ApiKey = z.string().trim().min(1).max(CONFIG.limits.immichKeyCharacters).regex(/^[\x21-\x7E]+$/)

export const Connection = z.object({
  id: z.uuid(),
  server: z.string().refine(value => immichUrl(value) === value),
  apiKey: ApiKey,
  lastAlbumId: z.uuid().nullable(),
})

export type ImmichConnection = z.infer<typeof Connection>

export const Destination = z.object({ connectionId: z.uuid(), albumId: z.uuid() })

export type ImmichDestination = z.infer<typeof Destination>

export interface PreparedDestination extends ImmichDestination {
  latestPhotoAt: string | null
}

/** Only the released v3.4.1 fields used to list writable albums are consumed. */
export const Album = z.object({
  id: z.uuid(),
  albumName: z.string().min(1).max(CONFIG.limits.nameCharacters),
  createdAt: z.iso.datetime({ offset: true }),
  albumUsers: z.array(z.object({ role: z.enum(['owner', 'editor', 'viewer']), user: z.object({ id: z.uuid() }) })).min(1),
})

export interface ImmichAlbum {
  id: string
  name: string
}

export interface AlbumSelection {
  albums: ImmichAlbum[]
  selectedId: string | null
  connectionId: string
}

export interface ConnectionStatus {
  connected: boolean
  server: string
}
