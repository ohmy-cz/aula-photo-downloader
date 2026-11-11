import type { ImmichDestination } from '../../immich/contracts'
import type { Summary } from '../../types'
import type { BatchProgress } from './download-batch'
import { currentGallery, galleryKey } from '../../api/gallery'
import { sleep } from '../../async'
import { CONFIG } from '../../config'
import { errorCode } from '../../errors'
import { archiveZoneDay } from '../../metadata/dates'
import { request } from '../client'
import { t, translateError } from '../i18n'
import { downloadBatch } from './download-batch'
import { createStore } from './store'

interface Dates {
  all: boolean
  today: boolean
  cutoff: string
  latest: string
}

interface DownloaderState {
  dates: Dates
  childTags: boolean
  immichConnected: boolean
  loading: boolean
  controller: AbortController | null
  status: string
  error: boolean
  apiVersion: number
  batch: BatchProgress | null
  summary: Summary | null
  fileErrors: { id: number, filename: string, reason: string }[]
}

/** Start a gallery with fresh counts and Copenhagen date defaults, retaining no other album's state. */
const initialGalleryState = (): Omit<DownloaderState, 'controller'> => {
  const today = archiveZoneDay()

  return {
    dates: {
      all: true,
      today: true,
      latest: today,
      cutoff: today,
    },
    loading: true,
    childTags: true,
    immichConnected: false,
    status: '',
    error: false,
    apiVersion: CONFIG.aula.apiVersion,
    batch: null,
    summary: null,
    fileErrors: [],
  }
}

/** Own gallery selection, receipts and cancellation independently of the rendering framework. */
export const createDownloaderModel = () => {
  const store = createStore<DownloaderState>({ ...initialGalleryState(), controller: null })

  let key = ''

  let selection: { page: string, url: string } | undefined

  let refreshGeneration = 0

  let navigationPending = false

  let manualDates = false

  const status = (text: string, error = false) => {
    if (!navigationPending) {
      store.update({ status: text, error })
    }
  }

  /** Merge each summary in one update; retries replace existing rows without quadratic per-row copies. */
  const mergeFileErrors = (entries: DownloaderState['fileErrors']) => {
    const rows = new Map(
      store.getSnapshot().fileErrors.map(row => [row.id, row]),
    )

    for (const row of entries) {
      rows.set(row.id, row)
    }

    return [...rows.values()]
  }

  const fileError = (id: number, filename: string, reason: string) => {
    if (!navigationPending) {
      store.update({ fileErrors: mergeFileErrors([{ id, filename, reason }]) })
    }
  }

  /** Read only this gallery/filter's last completed import date. */
  const refreshSummary = async (destination?: ImmichDestination | null) => {
    const selectedKey = key

    const generation = refreshGeneration

    const summary = await request<Summary>({ type: 'gallery', key: selectedKey, ...(destination !== undefined ? { destination } : {}) })

    if (generation === refreshGeneration && selectedKey === key) {
      store.update({ summary, immichConnected: summary.immichConnected ?? false })
    }

    return summary
  }

  const isDownloading = () => store.getSnapshot().controller !== null

  /** Resolve Today consistently for restored checkpoints, user edits and post-midnight completion. */
  const setDates = (patch: Partial<Dates>) => {
    const dates = { ...store.getSnapshot().dates, ...patch }

    if (dates.today) {
      dates.latest = archiveZoneDay()
    }

    store.update({ dates })
  }

  /** Restore only the selected gallery's checkpoint; superseded navigation/refresh replies cannot update the panel. */
  const selectGallery = async (reset: boolean) => {
    const page = location.href

    const generation = refreshGeneration

    const url = currentGallery(
      page,
      performance.getEntriesByType('resource') as PerformanceResourceTiming[],
      selection,
    )

    const nextKey = await galleryKey(url)

    if (generation !== refreshGeneration || page !== location.href) {
      return
    }

    const changed = nextKey !== key

    key = nextKey

    if (changed) {
      store.update({
        apiVersion: CONFIG.aula.apiVersion,
        fileErrors: [],
        summary: null,
      })

      if (!isDownloading()) {
        store.update({ batch: null, status: '', error: false })
      }
    }

    selection = { page, url }

    const summary = await refreshSummary()

    if (generation !== refreshGeneration || page !== location.href) {
      return
    }

    if (reset || changed) {
      manualDates = false

      setDates({
        today: true,
        cutoff: summary.checkpoint ?? archiveZoneDay(),
        all: summary.checkpoint === null,
      })
    }

    store.update({ loading: false })

    return url
  }

  /** Retry only idle, idempotent gallery reads; newer refreshes and Start invalidate old retries. */
  const refresh = () => {
    if (isDownloading()) {
      return
    }

    const generation = ++refreshGeneration

    /** Retry only transient idle reads; a newer generation or Start supersedes pending retries. */
    const run = async () => {
      for (
        let attempt = 1;
        attempt <= CONFIG.limits.galleryRefreshAttempts;
        attempt++
      ) {
        if (isDownloading() || generation !== refreshGeneration) {
          return
        }

        try {
          await selectGallery(true)

          if (
            !isDownloading()
            && generation === refreshGeneration
            && !store.getSnapshot().batch
          ) {
            status('')
          }

          return
        }
        catch (error) {
          if (isDownloading() || generation !== refreshGeneration) {
            return
          }

          if (
            attempt === CONFIG.limits.galleryRefreshAttempts
            || !['operation', 'reload', 'album-load'].includes(errorCode(error))
          ) {
            store.update({ loading: false })

            status(translateError(error), true)

            return
          }

          await sleep(CONFIG.timing.galleryRefreshRetryMs)
        }
      }
    }

    void run()
  }

  /** Snapshot destination-specific bounds at submission; preserve explicit dates, and resolve Today in Copenhagen across midnight/DST. */
  const start = async (destination: ImmichDestination | null = null, photoCutoff: string | null = null) => {
    if (isDownloading() || store.getSnapshot().loading) {
      return
    }

    refreshGeneration++

    const active = new AbortController()

    const batch: BatchProgress = {
      phase: 'collecting',
      total: 0,
      totalKnown: false,
      completed: 0,
      failures: 0,
      importing: destination !== null,
    }

    const progress = (patch: Partial<DownloaderState> = {}) => {
      if (!navigationPending) {
        store.update({ ...patch, batch: { ...batch } })
      }
    }

    store.update({
      controller: active,
      fileErrors: [],
      batch,
    })

    status(t('collecting'))

    const started = archiveZoneDay()

    try {
      const url = await selectGallery(false)

      if (url === undefined || active.signal.aborted) {
        return
      }

      const summary = await refreshSummary(destination)

      if (!manualDates) {
        setDates({ cutoff: summary.checkpoint ?? archiveZoneDay(), all: summary.checkpoint === null })
      }

      const dates = store.getSnapshot().dates

      const first = dates.today ? archiveZoneDay() : dates.latest

      const bounds = dates.all
        ? { cutoff: null, until: first }
        : {
            cutoff: first <= dates.cutoff ? first : dates.cutoff,
            until: first <= dates.cutoff ? dates.cutoff : first,
          }

      await downloadBatch({
        key,
        url,
        ...bounds,
        childTags: store.getSnapshot().childTags,
        destination,
        photoCutoff,
        signal: active.signal,
        batch,
        started,
        progress,
        status,
        fileError,
        apiVersion: (version) => {
          if (!navigationPending) {
            store.update({ apiVersion: version })
          }
        },
        checkpoint: (day) => {
          if (!navigationPending) {
            setDates({ cutoff: day, all: false })
          }
        },
      })
    }
    catch (error) {
      status(
        active.signal.aborted ? t(destination ? 'importStopped' : 'stoppedSaved') : translateError(error),
        !active.signal.aborted,
      )
    }
    finally {
      if (!navigationPending) {
        await refreshSummary(destination).catch(() => undefined)
      }

      if (navigationPending) {
        navigationPending = false

        store.update({ controller: null })

        refresh()
      }
      else {
        if (batch.phase !== 'finished') {
          batch.phase = active.signal.aborted ? 'stopped' : 'error'
        }

        setDates({})

        progress({ controller: null, loading: false })
      }
    }
  }

  /** Stop remains pending until the current background operation confirms its final receipt. */
  const stop = () => {
    const controller = store.getSnapshot().controller

    if (controller) {
      controller.abort()

      store.update({ controller })

      status(t(store.getSnapshot().batch?.importing ? 'importStopping' : 'stopping'))
    }
  }

  return {
    ...store,
    refresh,
    start,
    stop,
    openSettings: async () => {
      try {
        await request({ type: 'open-settings' })
      }
      catch (error) {
        status(translateError(error), true)
      }
    },
    refreshConnection: () => {
      if (!isDownloading() && key) {
        void refreshSummary().catch(() => undefined)
      }
    },
    setChildTags: (childTags: boolean) => {
      if (!isDownloading()) {
        store.update({ childTags })
      }
    },
    /** Ignore edits while downloading; Today always resolves in the archive timezone. */
    setDates: (patch: Partial<Dates>) => {
      if (!isDownloading()) {
        manualDates = true

        setDates(patch)
      }
    },
    /** Clear album state immediately; cancel its queue and await its current receipt before unlocking the next album. */
    navigate: () => {
      if (isDownloading()) {
        navigationPending = true

        stop()
      }

      refreshGeneration++

      key = ''

      selection = undefined

      manualDates = false

      store.update({ ...initialGalleryState(), childTags: store.getSnapshot().childTags, immichConnected: store.getSnapshot().immichConnected })

      if (!navigationPending) {
        refresh()
      }
    },
  }
}

export type DownloaderModel = ReturnType<typeof createDownloaderModel>
