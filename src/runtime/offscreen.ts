import type { ImmichConnection } from '../immich/contracts'
import type { ProcessedMedia } from '../metadata/formats'
import type { Job, WorkerResult } from '../types'
import { CONFIG } from '../config'
import { AppError, errorCode } from '../errors'
import { importProcessed } from '../immich/client'
import {
  isMediaMime,
  mediaBlob,

} from '../metadata/formats'
import { fetchInput } from './input'

let active: string | null = null

const blobs = new Map<
  string,
  { url: string, timer: ReturnType<typeof setTimeout> }
>()

/** Notify the background after the last job and output lease release; failed cleanup is safe to retry later. */
const reportIdle = (): void => {
  if (active === null && blobs.size === 0) {
    void chrome.runtime
      .sendMessage<
      unknown,
        Record<string, unknown> | undefined
    >({ type: 'offscreen-idle' })
      .catch(() => undefined)
  }
}

/** Completion releases the blob early; a lease also bounds abandoned output lifetime. */
const releaseBlob = (id: string): void => {
  const blob = blobs.get(id)

  if (blob) {
    clearTimeout(blob.timer)

    URL.revokeObjectURL(blob.url)

    blobs.delete(id)

    reportIdle()
  }
}

/** Transfer input once, and always terminate the worker after success, failure or timeout. */
const processInWorker = async (
  job: Job,
  bytes: ArrayBuffer,
): Promise<ProcessedMedia> => {
  let timer: ReturnType<typeof setTimeout> | undefined

  const worker = new Worker(
    chrome.runtime.getURL(CONFIG.browser.workerScript),
    {
      type: 'module',
    },
  )

  try {
    return await new Promise<ProcessedMedia>((resolve, reject) => {
      timer = setTimeout(() => {
        reject(new AppError('media-timeout'))
      }, CONFIG.timing.processingMs)

      worker.onerror = () => {
        reject(new AppError('worker-unavailable'))
      }

      worker.onmessage = (event: MessageEvent<WorkerResult>) => {
        if (event.data.id !== job.id) {
          return
        }

        if (
          event.data.bytes instanceof ArrayBuffer
          && event.data.bytes.byteLength
          && event.data.bytes.byteLength <= CONFIG.limits.mediaBytes
          && isMediaMime(event.data.mime)
        ) {
          resolve({ bytes: event.data.bytes, mime: event.data.mime })
        }
        else {
          reject(new AppError('worker-unavailable'))
        }
      }

      worker.postMessage({ ...job, bytes }, [bytes])
    })
  }
  finally {
    clearTimeout(timer)

    worker.terminate()
  }
}

/**
 * Fetch and process one original, then upload it or lease its blob for download.
 * Imports are acknowledged only after album assignment; failures never create fallback downloads.
 */
const run = async (job: Job, transfer: { connection: ImmichConnection, albumId: string } | null): Promise<void> => {
  try {
    if (job.media.size !== null && job.media.size > CONFIG.limits.mediaBytes) {
      throw new AppError('media-size')
    }

    const bytes = await fetchInput(job)

    if (!job.media.capture) {
      throw new AppError('capture-missing')
    }

    const output = await processInWorker(job, bytes)

    if (transfer) {
      await importProcessed(transfer.connection, transfer.albumId, job, output)

      await chrome.runtime.sendMessage({ type: 'worker-ready', id: job.id, imported: true })

      return
    }

    const url = URL.createObjectURL(mediaBlob(output))

    blobs.set(job.id, {
      url,
      timer: setTimeout(() => {
        releaseBlob(job.id)
      }, CONFIG.timing.blobLeaseMs),
    })

    const reply = await chrome.runtime.sendMessage<
      unknown,
      Record<string, unknown> | undefined
    >({
      type: 'worker-ready',
      id: job.id,
      blobUrl: url,
    })

    const accepted = Boolean(reply?.ok)

    if (!accepted) {
      releaseBlob(job.id)
    }
  }
  catch (error) {
    releaseBlob(job.id)

    await chrome.runtime
      .sendMessage({
        type: 'worker-ready',
        id: job.id,
        error:
          errorCode(error) === 'operation'
            ? 'worker-unavailable'
            : errorCode(error),
      })
      .catch(() => undefined)
  }
  finally {
    active = null

    reportIdle()
  }
}

/** Handle extension-context controls; acknowledge accepted jobs before reporting their results through worker-ready. */
chrome.runtime.onMessage.addListener((raw: unknown, sender, respond) => {
  const message
    = raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : undefined

  if (
    sender.id !== chrome.runtime.id
    || sender.tab
    || !message
    || typeof message.type !== 'string'
  ) {
    return
  }

  if (message.type === 'offscreen-status') {
    respond({ jobId: active, blobs: blobs.size })

    return
  }

  if (message.type === 'offscreen-release' && typeof message.id === 'string') {
    releaseBlob(message.id)

    respond({ ok: true })

    return
  }

  if (message.type === 'offscreen-start') {
    if (active !== null) {
      respond({ error: 'Another image is processing.' })

      return
    }

    const job = message.job as Job

    active = job.id

    respond({ ok: true })

    void run(job, message.transfer as { connection: ImmichConnection, albumId: string } | null)
  }
})
