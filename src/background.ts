import { handlePageRequest } from './background/requests'
import { CONFIG, ROOT_FOLDER } from './config'
import { handleWorkerReady } from './downloads/coordinator'
import { finalizeDownload, reconcilePending } from './downloads/receipts'
import { AppError, errorCode } from './errors'
import { handleImmichRequest, handleThumbnailRequest } from './immich/requests'
import { activatedTab, isAulaSender, isOffscreenSender } from './messages'
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

/** Preview latency must not delay Stop, download receipts or other serialized state changes. */
const thumbnail = async (message: Record<string, unknown>, sender: chrome.runtime.MessageSender) => {
  await initialization

  await activatedTab(sender)

  return handleThumbnailRequest(message)
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

  const fail = (error: unknown) => respond({ error: errorCode(error) })

  if (message.type === 'immich-thumbnail') {
    void thumbnail(message, sender).then(respond).catch(fail)

    return true
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
      || !['gallery', 'begin', 'process', 'status', 'cancel', 'finish', 'open-settings', 'immich-albums', 'immich-select', 'immich-create-album'].includes(
        String(message.type),
      )
    ) {
      throw new AppError('operation')
    }

    const tabId = await activatedTab(sender)

    if (message.type === 'open-settings') {
      await chrome.runtime.openOptionsPage()

      return { ok: true }
    }

    if (['immich-albums', 'immich-select', 'immich-create-album'].includes(String(message.type))) {
      return handleImmichRequest(state, message, false)
    }

    return handlePageRequest(state, message, tabId)
  }).then(respond).catch(fail)

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
