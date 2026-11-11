import type { AulaV25Albums, AulaV25Media, AulaV25Page } from './contracts'
import { z } from 'zod'
import { CONFIG } from '../config'
import { AppError } from '../errors'
import { archiveZoneDay } from '../metadata/dates'

import { cleanNames, mediaName, mediaUrl, validDay } from '../security'
import {
  API_VERSION,

} from './contracts'

const tagSchema = z.object({
  role: z.string().min(1),
  name: z.string().max(CONFIG.limits.nameCharacters),
})

const mediaSchema: z.ZodType<AulaV25Media> = z.object({
  id: z.number().int().positive(),
  mediaType: z.string().min(1),
  tags: z.array(tagSchema).max(CONFIG.limits.childTags),
  isDeleted: z.boolean().optional(),
  isUploadPending: z.boolean().nullable().optional(),
  file: z.object({
    name: z.string().min(1).max(CONFIG.limits.nameCharacters),
    created: z.string().nullable().optional(),
    url: z.string().max(CONFIG.limits.mediaUrlCharacters).nullable(),
    size: z.number().nonnegative().nullable().optional(),
  }),
})

const pageSchema: z.ZodType<AulaV25Page> = z.object({
  version: z.number().int().min(API_VERSION),
  module: z.literal('gallery'),
  method: z.literal('getMedia'),
  status: z.object({ code: z.number().int(), message: z.string().optional() }),
  data: z.object({
    album: z
      .object({ name: z.string().optional(), title: z.string().optional() })
      .nullable(),
    mediaCount: z.number().int().nonnegative().optional(),
    totalSize: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().optional(),
    startIndex: z.number().int().nonnegative(),
    results: z.array(mediaSchema).max(CONFIG.aula.maxPageSize),
  }),
})

const albumsSchema: z.ZodType<AulaV25Albums> = z.object({
  version: z.number().int().min(API_VERSION),
  module: z.literal('gallery'),
  method: z.literal('getAlbums'),
  status: z.object({ code: z.number().int() }),
  data: z
    .array(
      z.object({
        id: z.number().int().positive().nullable(),
        title: z.string().trim().min(1).max(CONFIG.limits.nameCharacters),
      }),
    )
    .max(CONFIG.aula.maxPageSize),
})

/** Enforce the requested version and v25 naming fields, including on a negotiated newer API. */
export const decodeV25Albums = (value: unknown, version = API_VERSION) => {
  const result = albumsSchema.safeParse(value)

  if (!result.success) {
    throw new AppError('api-contract')
  }

  if (result.data.version !== version) {
    throw new AppError('api-version')
  }

  if (result.data.status.code !== 0) {
    throw new AppError('api-login')
  }

  return result.data.data
}

export interface SourceMedia {
  id: number
  filename: string
  day: string | null
  kind: 'photo' | 'video'
  children: string[]
  url: string | null
  size: number | null
}

/** Validate consumed v25 fields while accepting unrelated upstream additions. Never include payloads in errors. */
export const decodeV25Media = (value: unknown): AulaV25Media => {
  const result = mediaSchema.safeParse(value)

  if (!result.success) {
    throw new AppError('api-contract')
  }

  return result.data
}

/** Reuse v25 field validation on negotiated newer APIs; require the exact requested version and offset. */
export const decodeV25Page = (
  value: unknown,
  index: number,
  version = API_VERSION,
): AulaV25Page => {
  if (
    value !== null
    && typeof value === 'object'
    && 'version' in value
    && value.version !== version
  ) {
    throw new AppError('api-version')
  }

  const envelope = z
    .object({ status: z.object({ code: z.number().int() }) })
    .safeParse(value)

  if (envelope.success && envelope.data.status.code !== 0) {
    throw new AppError('api-login')
  }

  const result = pageSchema.safeParse(value)

  if (!result.success) {
    throw new AppError('api-contract')
  }

  if (result.data.data.startIndex !== index) {
    throw new AppError('api-pagination')
  }

  return result.data
}

/** Convert provider fields to the internal DTO; unavailable originals remain visible and block completion. */
export const mapV25Media = (value: unknown): SourceMedia => {
  const item = decodeV25Media(value)

  const created = item.file.created

  const day
    = typeof created === 'string'
      && /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(created)
      && validDay(created.slice(0, 10))
      && Number.isFinite(Date.parse(created))
      ? archiveZoneDay(new Date(created))
      : null

  let url: string | null = null

  if (
    ['image', 'video'].includes(item.mediaType)
    && !item.isDeleted
    && !item.isUploadPending
  ) {
    try {
      url = mediaUrl(item.file.url).href
    }
    catch {
      // Missing or unapproved originals cannot be replaced with thumbnails.
    }
  }

  return {
    id: item.id,
    filename: mediaName(item.file.name),
    day,
    kind: item.mediaType === 'video' ? 'video' : 'photo',
    children: cleanNames(
      item.tags.filter(tag => tag.role === 'child').map(tag => tag.name),
    ),
    url,
    size: item.file.size ?? null,
  }
}
