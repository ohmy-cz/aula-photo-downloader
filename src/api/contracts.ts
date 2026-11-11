export const API_VERSION = 25

/** The v25 fields consumed by the downloader; unrelated upstream fields are deliberately excluded. */
export interface AulaV25Media {
  id: number
  mediaType: string
  tags: { role: string, name: string }[]
  isDeleted?: boolean
  isUploadPending?: boolean | null
  file: {
    name: string
    created?: string | null
    url: string | null
    size?: number | null
  }
}

/** Required gallery envelope and pagination fields; version must also match the requested endpoint. */
export interface AulaV25Page {
  version: number
  module: 'gallery'
  method: 'getMedia'
  status: { code: number, message?: string }
  data: {
    album: { name?: string, title?: string } | null
    mediaCount?: number
    totalSize?: number
    limit?: number
    startIndex: number
    results: AulaV25Media[]
  }
}

/** Only naming fields are needed from the optional album-list lookup. */
export interface AulaV25Albums {
  version: number
  module: 'gallery'
  method: 'getAlbums'
  status: { code: number }
  data: { id: number | null, title: string }[]
}
