import type { ImmichDestination } from './immich/contracts'

export interface Capture {
  day: string
  time: string
  offset: string
  utc: string
  basis: 'filename' | 'upload-sequence'
}

export interface Media {
  id: number
  filename: string
  position: number
  order: 'asc' | 'desc'
  day: string | null
  kind: 'photo' | 'video'
  children: string[]
  url: string | null
  size: number | null
  capture: Capture | null
}

export interface Job {
  id: string
  media: Media
  filename: string
}

export type Pending = {
  job: Job
  started: number
} & (
  | { stage: 'processing' }
  | { stage: 'downloading', blobUrl: string, downloadId?: number }
)

export interface Operation {
  runId: string
  jobId: string
}

export interface Run {
  id: string
  tabId: number
  key: string
  folder: string
  started: string
  cutoff: string | null
  until: string
  expected: number
  completed: number
  childTags: boolean
  destination: ImmichDestination | null
  failed: boolean
  cancelled: boolean
  operation?: {
    jobId: string
    mediaId: number
    pending?: Pending
    result?: 'processed' | 'imported'
    error?: import('./errors').ErrorCode
  }
}

export interface State {
  schema: 4
  checkpoints: Record<string, string>
  run?: Run
}

export interface Summary {
  checkpoint: string | null
  immichConnected?: boolean
}

export type Request
  = | { type: 'gallery', key: string, destination?: ImmichDestination | null }
    | {
      type: 'begin'
      key: string
      name: string
      started: string
      cutoff: string | null
      until: string
      expected: number
      childTags: boolean
      destination?: ImmichDestination | null
    }
    | { type: 'process', runId: string, media: Media }
    | { type: 'status', operation: Operation }
    | { type: 'cancel' | 'finish', runId: string }
    | { type: 'open-settings' | 'immich-status' | 'immich-disconnect' | 'immich-albums' }
    | { type: 'immich-connect', server: string, apiKey: string }
    | { type: 'immich-select', destination: ImmichDestination }

export type ProcessResult
  = | { mode: 'working', operation: Operation }
    | { mode: 'processed' }
    | { mode: 'imported' }

export interface WorkerResult {
  id: string
  bytes?: ArrayBuffer
  mime?: import('./metadata/formats').MediaMime
  error?: string
}
