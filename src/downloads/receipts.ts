import type { ErrorCode } from '../errors'
import type { State } from '../types'
import { AppError } from '../errors'
import { releaseOutputBlob } from '../runtime/offscreen-client'
import { saveRun } from '../storage/repository'

/** Store a terminal error before releasing its resources; errors never produce fallback downloads. */
export const failOperation = async (
  state: State,
  error: ErrorCode,
): Promise<void> => {
  const run = state.run

  const pending = run?.operation?.pending

  if (!run?.operation) {
    return
  }

  run.failed = true

  run.operation.error = error

  delete run.operation.pending

  await saveRun(state)

  if (pending) {
    await releaseOutputBlob(pending)
  }
}

/** Confirm Chrome's receipt exactly once, persisting the count before releasing the output lease. */
export const finalizeDownload = async (state: State): Promise<boolean> => {
  const run = state.run

  const operation = run?.operation

  const pending = operation?.pending

  if (
    !run
    || !operation
    || pending?.stage !== 'downloading'
    || pending.downloadId === undefined
  ) {
    return false
  }

  const [item] = await chrome.downloads.search({ id: pending.downloadId })

  if (!item || item.state === 'interrupted') {
    await failOperation(state, 'download-failed')

    return true
  }

  if (item.state !== 'complete') {
    return false
  }

  if (item.finalUrl !== pending.blobUrl) {
    await failOperation(state, 'download-url')

    return true
  }

  operation.result = 'processed'

  delete operation.pending

  run.completed++

  if (
    run.cancelled
    && !(await chrome.tabs.get(run.tabId).catch(() => undefined))
  ) {
    delete state.run
  }

  await saveRun(state)

  await releaseOutputBlob(pending)

  return true
}

/** Recover only this session's active job; never discard a real download still owned by Chrome. */
export const reconcilePending = async (state: State): Promise<void> => {
  const pending = state.run?.operation?.pending

  if (!pending || (await finalizeDownload(state))) {
    return
  }

  if (pending.stage === 'downloading') {
    if (pending.downloadId !== undefined) {
      return
    }

    const candidates = (
      await chrome.downloads.search({
        startedAfter: new Date(Math.max(0, pending.started - 1)).toISOString(),
      })
    ).filter(
      item =>
        item.byExtensionId === chrome.runtime.id
        && item.url === pending.blobUrl,
    )

    if (candidates.length > 1) {
      throw new AppError('download-review')
    }

    if (candidates[0]) {
      pending.downloadId = candidates[0].id

      await saveRun(state)

      await finalizeDownload(state)
    }
    else {
      await failOperation(state, 'download-not-started')
    }

    return
  }

  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  })

  if (contexts.length) {
    const status = await chrome.runtime.sendMessage<
      unknown,
      { jobId?: string } | undefined
    >({ type: 'offscreen-status' })

    if (status?.jobId === pending.job.id) {
      return
    }
  }

  await failOperation(state, 'worker-closed')
}
