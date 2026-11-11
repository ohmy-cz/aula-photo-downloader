import type { Operation, Run, State, Summary } from '../../src/types'
import { parseMedia } from '../../src/api'
import { CONFIG } from '../../src/config'
import { archiveZoneDay } from '../../src/metadata/dates'
import { required } from '../../src/required'

interface Reply extends Partial<Summary> {
  mode?: 'working' | 'processed'
  operation?: Operation
  runId?: string
  error?: string
  ok?: boolean
}

type Sender = Pick<chrome.runtime.MessageSender, 'id' | 'url'> & {
  tab?: Pick<chrome.tabs.Tab, 'id'>
}

type Handler = (
  message: unknown,
  sender: Sender,
  respond: (reply: Reply) => void,
) => boolean | undefined

type Download = Pick<
  chrome.downloads.DownloadItem,
  | 'id'
  | 'byExtensionId'
  | 'state'
  | 'startTime'
  | 'endTime'
  | 'exists'
  | 'filename'
  | 'url'
  | 'finalUrl'
>

export const handlers: Handler[] = []

export const changed: ((delta: chrome.downloads.DownloadDelta) => void)[] = []

export const removed: ((id: number) => void)[] = []

export const filenames: ((
  item: Pick<chrome.downloads.DownloadItem, 'byExtensionId' | 'url'>,
  suggest: (value?: chrome.downloads.FilenameSuggestion) => void,
) => boolean | undefined)[] = []

export let store: Record<string, unknown> = {}

export let sessionStore: Record<string, unknown> = {}

export let jobs = new Map<number, Download>()

export let starts: Record<string, unknown>[] = []

export let access = ''

export const closedTabs = new Set<number>()

export const url = (name: string) =>
  `chrome-extension://test-extension/${name}`

/** Read the current dates-only state and active run without reconstructing any historical receipts. */
export const stored = () => ({
  ...(store[CONFIG.archive.storageKey] as State),
  run: sessionStore[CONFIG.archive.runStorageKey] as Run | undefined,
})

export const activeRun = () => required(stored().run)

export const pendingJob = () => required(activeRun().operation?.pending)

/** Edit only the session checkpoint to model a worker's lost-ID write window. */
export const editPending = (
  edit: (pending: NonNullable<Run['operation']>['pending']) => void,
) => {
  edit(pendingJob())
}

export const api = {
  runtime: {
    id: 'test-extension',
    getURL: url,
    getContexts: async () => Promise.resolve([{}]),
    ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' },
    sendMessage: async (message: Record<string, unknown>) => {
      starts.push(message)

      const pending = stored().run?.operation?.pending

      return Promise.resolve(
        message.type === 'offscreen-status'
          ? {
              jobId: pending?.stage === 'processing' ? pending.job.id : null,
              blobs: pending?.stage === 'downloading' ? 1 : 0,
            }
          : { ok: true },
      )
    },
    onMessage: {
      addListener: (handler: Handler) => {
        handlers.push(handler)
      },
    },
  },
  tabs: {
    get: async (id: number) =>
      closedTabs.has(id)
        ? Promise.reject(new Error('Tab closed'))
        : Promise.resolve({ id }),
    onRemoved: {
      addListener: (handler: (id: number) => void) => {
        removed.push(handler)
      },
    },
  },
  storage: {
    session: {
      setAccessLevel: async () => Promise.resolve(),
      get: async () => Promise.resolve(structuredClone(sessionStore)),
      set: async (value: Record<string, unknown>) => {
        Object.assign(sessionStore, structuredClone(value))

        return Promise.resolve()
      },
      remove: async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) {
          Reflect.deleteProperty(sessionStore, key)
        }

        return Promise.resolve()
      },
      clear: async () => {
        sessionStore = {}

        return Promise.resolve()
      },
    },
    local: {
      setAccessLevel: async ({ accessLevel }: { accessLevel: string }) => {
        access = accessLevel

        return Promise.resolve()
      },
      get: async () => Promise.resolve(structuredClone(store)),
      set: async (value: Record<string, unknown>) => {
        Object.assign(store, structuredClone(value))

        return Promise.resolve()
      },
      remove: async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) {
          Reflect.deleteProperty(store, key)
        }
      },
      clear: async () => {
        store = {}

        return Promise.resolve()
      },
    },
  },
  offscreen: {
    Reason: { WORKERS: 'WORKERS', BLOBS: 'BLOBS' },
    createDocument: async () => Promise.resolve(),
    closeDocument: async () => Promise.resolve(),
  },
  downloads: {
    download: async (options: chrome.downloads.DownloadOptions) => {
      const id = jobs.size + 1

      const original = `/Downloads/${required(options.filename)}`

      let filename = original

      let suffix = 0

      while (
        [...jobs.values()].some(
          item => item.exists && item.filename === filename,
        )
      ) {
        filename = original.replace(/(\.[^.]+)$/, ` (${String(++suffix)})$1`)
      }

      jobs.set(id, {
        id,
        byExtensionId: 'test-extension',
        state: 'in_progress',
        startTime: new Date().toISOString(),
        exists: true,
        filename,
        url: options.url,
        finalUrl: options.url,
      })

      return Promise.resolve(id)
    },
    search: async (query: chrome.downloads.DownloadQuery) =>
      Promise.resolve(
        [...jobs.values()].filter(
          item =>
            (query.id === undefined || item.id === query.id)
            && (query.state === undefined || item.state === query.state)
            && (query.startedAfter === undefined || query.startedAfter === ''
              || Date.parse(item.startTime) > Date.parse(query.startedAfter))
            && (query.endedAfter === undefined || query.endedAfter === ''
              || Date.parse(item.endTime ?? '') > Date.parse(query.endedAfter)),
        ),
      ),
    onChanged: {
      addListener: (handler: (typeof changed)[number]) => {
        changed.push(handler)
      },
    },
    onDeterminingFilename: {
      addListener: (handler: (typeof filenames)[number]) => {
        filenames.push(handler)
      },
    },
  },
}

Object.assign(globalThis, { chrome: api })

await import('../../src/background')

export const sender: Sender = {
  id: 'test-extension',
  url: 'https://www.aula.dk/portal/#/galleri/minemedier',
  tab: { id: 1 },
}

export const key = 'a'.repeat(64)

/** Fresh synthetic media exercises real DTO mapping without account or signed URL secrets. */
export const media = () =>
  parseMedia(
    {
      id: 1,
      mediaType: 'image',
      tags: [{ name: 'Synthetic Child A', role: 'child' }],
      file: {
        name: '20260430_095302.jpg',
        created: '2026-04-30T09:53:02Z',
        url: 'https://media-prod.aula.dk/synthetic/1.jpg?Signature=synthetic',
      },
    },
    1,
    'desc',
  )

/** Dispatch through the actual sender checks and serialized background listener. */
export const message = async (
  input: Record<string, unknown>,
  source = sender,
): Promise<Reply> =>
  new Promise((resolve) => {
    required(handlers[0])(input, source, resolve)
  })

/** Begin an explicit batch, using the same Copenhagen submission day as the panel. */
export const begin = async (patch: Record<string, unknown> = {}) =>
  message({
    type: 'begin',
    key,
    name: 'Test album',
    expected: 1,
    childTags: true,
    started: archiveZoneDay(),
    cutoff: null,
    until: archiveZoneDay(),
    ...patch,
  })

/** Clear fixture data while retaining the event listeners installed by the real background module. */
export const reset = () => {
  store = {}

  sessionStore = {
    [`${CONFIG.archive.activationStorageKey}:1`]: true,
  }

  jobs = new Map()

  starts = []

  closedTabs.clear()
}

/** Emit actual worker and Chrome completion messages; the trailing read drains serialized events. */
export const ready = async () =>
  message(
    {
      type: 'worker-ready',
      id: pendingJob().job.id,
      blobUrl: `blob:${url(crypto.randomUUID())}`,
    },
    { id: 'test-extension', url: url('offscreen.html') },
  )

export const complete = async (id: number) => {
  const item = required(jobs.get(id))

  item.state = 'complete'

  item.endTime = new Date().toISOString()

  for (const handler of changed) {
    handler({ id, state: { current: 'complete' } })
  }

  await message({ type: 'gallery', key })
}
