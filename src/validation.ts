import { z } from 'zod'
import { storedName } from './security'

export const PositiveId = z.number().int().positive()

export const StoredFilename = z.string().refine(storedName)

export const GalleryKey = z.string().regex(/^[a-f0-9]{64}$/)
