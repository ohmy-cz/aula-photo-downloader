import type { Pending } from '../types'
import { CONFIG } from '../config'

/** Serialize idle checks with job starts; output leases keep their owning document alive. */
export const closeIdleOffscreen = async (): Promise<void> => {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  })

  if (!contexts.length) {
    return
  }

  const status = await chrome.runtime.sendMessage<
    unknown,
    Record<string, unknown> | undefined
  >({ type: 'offscreen-status' })

  if (status?.jobId === null && status.blobs === 0) {
    await chrome.offscreen.closeDocument()
  }
}

/** Reuse the document that owns processing and blob leases, creating it only when absent. */
export const ensureOffscreenDocument = async (): Promise<void> => {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  })

  if (!contexts.length) {
    await chrome.offscreen.createDocument({
      url: CONFIG.browser.offscreenPage,
      reasons: [chrome.offscreen.Reason.WORKERS, chrome.offscreen.Reason.BLOBS],
      justification:
        'Process media metadata privately in a local worker and download the corrected files.',
    })
  }
}

/** Release a completed or abandoned blob lease; a closed offscreen document makes cleanup unnecessary. */
export const releaseOutputBlob = async (pending: Pending): Promise<void> => {
  try {
    await chrome.runtime.sendMessage<
      unknown,
      Record<string, unknown> | undefined
    >({
      type: 'offscreen-release',
      id: pending.job.id,
    })
  }
  catch {
    // A closed offscreen document already released its blobs.
  }
}
