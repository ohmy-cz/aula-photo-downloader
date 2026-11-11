import type { Media, ProcessResult, State } from '../types'
import { CONFIG, ROOT_FOLDER } from '../config'
import { AppError, publicErrorCode } from '../errors'
import { ensureOffscreenDocument } from '../runtime/offscreen-client'
import { saveRun } from '../storage/repository'
import { download } from './browser'
import { operationStatus } from './operations'
import { failOperation } from './receipts'

/** Start one file in the authorized run; repeated submission of the current file reuses its operation. */
export const processMedia = async (
  state: State,
  media: Media,
): Promise<ProcessResult> => {
  const run = state.run

  if (!run || run.cancelled) {
    throw new AppError('file-retry')
  }

  if (run.operation?.mediaId === media.id) {
    return operationStatus(run)
  }

  if (run.operation?.pending) {
    throw new AppError('worker-busy')
  }

  if (run.completed >= run.expected) {
    throw new AppError('operation')
  }

  if (media.size !== null && media.size > CONFIG.limits.mediaBytes) {
    throw new AppError('media-size')
  }

  if (!media.capture) {
    throw new AppError('capture-missing')
  }

  const job = { id: crypto.randomUUID(), media, filename: media.filename }

  run.operation = {
    jobId: job.id,
    mediaId: media.id,
    pending: { stage: 'processing', started: Date.now(), job },
  }

  await saveRun(state)

  try {
    await ensureOffscreenDocument()

    const reply = await chrome.runtime.sendMessage<
      unknown,
      { ok?: boolean } | undefined
    >({ type: 'offscreen-start', job })

    if (!reply?.ok) {
      throw new AppError('worker-busy')
    }
  }
  catch {
    await failOperation(state, 'worker-unavailable')
  }

  return operationStatus(run)
}

/** Persist the local blob before Chrome's filename event can fire; failed processing never downloads originals. */
export const handleWorkerReady = async (
  state: State,
  message: Record<string, unknown>,
) => {
  const run = state.run

  const operation = run?.operation

  const pending = operation?.pending

  if (
    !run
    || !operation
    || pending?.stage !== 'processing'
    || message.id !== pending.job.id
  ) {
    return { ok: false }
  }

  const failed = Boolean(message.error)

  if (
    failed
    || typeof message.blobUrl !== 'string'
    || !message.blobUrl.startsWith(`blob:${chrome.runtime.getURL('')}`)
  ) {
    await failOperation(
      state,
      failed ? publicErrorCode(message.error) : 'worker-unavailable',
    )

    return { ok: false }
  }

  const downloading = {
    ...pending,
    stage: 'downloading' as const,
    blobUrl: message.blobUrl,
    downloadId: undefined as number | undefined,
  }

  operation.pending = downloading

  await saveRun(state)

  try {
    downloading.downloadId = await download(
      downloading.blobUrl,
      `${ROOT_FOLDER}/${run.folder}/${downloading.job.filename}`,
    )

    await saveRun(state)
  }
  catch {
    // Chrome may have accepted the file before saving its ID failed. Keep its blob leased for recovery.
    if (downloading.downloadId !== undefined) {
      return { ok: true }
    }

    await failOperation(state, 'download-start')

    return { ok: false }
  }

  return { ok: true }
}
