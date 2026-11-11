import { handlePageRequest } from './background/requests'
import { CONFIG, ROOT_FOLDER } from './config'
import { handleWorkerReady } from './downloads/coordinator'
import { finalizeDownload, reconcilePending } from './downloads/receipts'
import { AppError, errorCode } from './errors'
import { handleImmichRequest } from './immich/requests'
import { isAulaSender, isOffscreenSender } from './messages'
import { closeIdleOffscreen } from './runtime/offscreen-client'
import { object } from './security'
import { clearHistory, loadHistory, saveRun } from './storage/repository'

let queue: Promise<unknown> = Promise.resolve()

/** Serialize receipt events and page operations so a suspended worker cannot double-count completion. */
const serialize = async <T>(operation: () => Promise<T>): Promise<T> => {
  const next = queue.catch(() => undefined).then(operation)

  queue = next

  return next
}

/** Authorize before queuing; only short replies remain open while Chrome owns long-running work. */
chrome.runtime.onMessage.addListener((raw: unknown, sender, respond) => {
  if (sender.id !== chrome.runtime.id) {
    return
  }

  let message: Record<string, unknown>

  try {
    message = object(raw)
  }
  catch {
    return
  }

  const offscreen = isOffscreenSender(sender)

  const popup
    = !sender.tab
      && sender.url === chrome.runtime.getURL(CONFIG.browser.popupPage)

  const settings = sender.url === chrome.runtime.getURL(CONFIG.browser.optionsPage)

  if (!offscreen && !popup && !settings && !isAulaSender(sender)) {
    return
  }

  void serialize(async () => {
    await initialization

    if (offscreen && message.type === 'offscreen-idle') {
      await closeIdleOffscreen()

      return { ok: true }
    }

    const state = await loadHistory()

    if (offscreen && message.type === 'worker-ready') {
      return handleWorkerReady(state, message)
    }

    await reconcilePending(state)

    if (popup && message.type === 'open-settings') {
      await chrome.runtime.openOptionsPage()

      return { ok: true }
    }

    if (settings && String(message.type).startsWith('immich-')) {
      return handleImmichRequest(state, message, true)
    }

    if (popup && message.type === 'clear-history') {
      const downloads = await chrome.downloads.search({ state: 'in_progress' })

      if (
        state.run
        || downloads.some(item => item.byExtensionId === chrome.runtime.id)
      ) {
        return { ok: false }
      }

      await clearHistory()

      return { ok: true }
    }

    if (
      offscreen
      || popup
      || settings
      || !['gallery', 'begin', 'process', 'status', 'cancel', 'finish', 'open-settings', 'immich-albums', 'immich-select'].includes(
        String(message.type),
      )
    ) {
      throw new AppError('operation')
    }

    const tabId = sender.tab?.id

    if (tabId === undefined) {
      throw new AppError('activation-required')
    }

    const slot = `${CONFIG.archive.activationStorageKey}:${String(tabId)}`

    if ((await chrome.storage.session.get(slot))[slot] !== true) {
      throw new AppError('activation-required')
    }

    if (message.type === 'open-settings') {
      await chrome.runtime.openOptionsPage()

      return { ok: true }
    }

    if (message.type === 'immich-albums' || message.type === 'immich-select') {
      return handleImmichRequest(state, message, false)
    }

    return handlePageRequest(state, message, tabId)
  })
    .then(respond)
    .catch((error: unknown) => {
      respond({ error: errorCode(error) })
    })

  return true
})

/** Finalize only the current operation; historical downloads no longer affect saved import dates. */
chrome.downloads.onChanged.addListener((delta) => {
  if (!['complete', 'interrupted'].includes(delta.state?.current ?? '')) {
    return
  }

  void serialize(async () => {
    await initialization

    const state = await loadHistory()

    const pending = state.run?.operation?.pending

    if (pending?.stage === 'downloading' && pending.downloadId === delta.id) {
      await finalizeDownload(state)
    }
  }).catch(() => undefined)
})

/** Preserve the active blob's original filename; Chrome adds collision suffixes without a filename index. */
chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  if (item.byExtensionId !== chrome.runtime.id) {
    suggest()

    return
  }

  void initialization
    .then(loadHistory)
    .then((state) => {
      const pending = state.run?.operation?.pending

      suggest(
        pending?.stage === 'downloading' && pending.blobUrl === item.url
          ? {
              filename: `${ROOT_FOLDER}/${state.run?.folder ?? ''}/${pending.job.filename}`,
              conflictAction: 'uniquify',
            }
          : undefined,
      )
    })
    .catch(() => {
      suggest()
    })

  return true
})

/** Closing the owner tab cancels its batch; any already-started Chrome download may still finish. */
chrome.tabs.onRemoved.addListener((tabId) => {
  void serialize(async () => {
    await initialization

    const state = await loadHistory()

    if (state.run?.tabId === tabId) {
      state.run.cancelled = true

      if (!state.run.operation?.pending) {
        delete state.run
      }

      await saveRun(state)
    }

    await chrome.storage.session.remove(
      `${CONFIG.archive.activationStorageKey}:${String(tabId)}`,
    )
  }).catch(() => undefined)
})

/** Restrict both storage areas before reading or recovering any private active-run data. */
const initialization = serialize(async () => {
  await chrome.storage.session.setAccessLevel({
    accessLevel: 'TRUSTED_CONTEXTS',
  })

  await chrome.storage.local.setAccessLevel({
    accessLevel: 'TRUSTED_CONTEXTS',
  })

  await reconcilePending(await loadHistory())

  await closeIdleOffscreen()
})

void initialization.catch(() => undefined)
