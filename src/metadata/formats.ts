// Use the format verified by ExifTool, rather than an empty Blob MIME type.
export const MEDIA_MIME = {
  JPEG: 'image/jpeg',
  PNG: 'image/png',
  TIFF: 'image/tiff',
  HEIC: 'image/heic',
  HEIF: 'image/heif',
  MP4: 'video/mp4',
  MOV: 'video/quicktime',
  MKV: 'video/x-matroska',
  WEBM: 'video/webm',
} as const

export type MediaMime = (typeof MEDIA_MIME)[keyof typeof MEDIA_MIME]

const mediaMimes = new Set<unknown>(Object.values(MEDIA_MIME))

/** Restrict worker MIME claims to the media formats supported by our processors. */
export const isMediaMime = (value: unknown): value is MediaMime =>
  mediaMimes.has(value)

export interface ProcessedMedia {
  bytes: ArrayBuffer
  mime: MediaMime
}

/** Retain the verified MIME type so browser downloads recognize the processed media. */
export const mediaBlob = (output: ProcessedMedia): Blob =>
  new Blob([output.bytes], { type: output.mime })
