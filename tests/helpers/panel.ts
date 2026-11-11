import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { galleryKey } from '../../src/api/gallery'
import { CONFIG, defaultGalleryUrl } from '../../src/config'
import { required } from '../../src/required'
import fixture from '../fixtures/aula/gallery-v25.json'
import { wireJSON } from '../fixtures/aula/mock'
import { changeInput, createDom, trustedEvents } from './react-dom'

const bundle = required(
  (
    await build({
      entryPoints: ['src/ui/material/content.tsx'],
      bundle: true,
      loader: { '.svg': 'dataurl' },
      write: false,
      format: 'iife',
    })
  ).outputFiles[0],
).text

/** Let the panel's asynchronous request/DOM work settle without relying on a browser timer. */
export const until = async (predicate: () => boolean): Promise<void> => {
  for (let i = 0; i < 300; i++) {
    if (predicate()) {
      return
    }

    await new Promise(resolve => setTimeout(resolve, 5))
  }

  assert.fail('Panel did not settle')
}

/** Run the actual content bundle in a disposable DOM with synthetic API/background responses. */
export const panel = async (
  languages = ['en-GB'],
  options: {
    empty?: boolean
    error?: string
    galleryFailures?: number
    processError?: string
    checkpoint?: string | null
    apiVersion?: number
    incompatibleApi?: boolean
    albumId?: number
    items?: number
    holdProcessing?: boolean
  } = {},
) => {
  const dom = createDom('<button id=\'launcher\'>Open downloader</button>', {
    url: `${CONFIG.aula.origin}/portal/${options.albumId === undefined ? CONFIG.aula.myMediaRoute : `#/galleri/${options.albumId}`}`,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  })

  const window = dom.window

  const click = trustedEvents(window)

  Object.defineProperty(window.navigator, 'languages', { value: languages })

  Object.defineProperty(window.navigator, 'language', {
    value: languages[0] ?? '',
  })

  const messages: { type: string, key?: string, runId?: string, media?: { filename: string } }[] = []

  const resources: { name: string }[] = []

  const checkpoints = new Map<string, string | null>()

  let runNumber = 0

  let releaseProcess: (() => void) | undefined

  let holdNextSummary = false

  let releaseSummary: (() => void) | undefined

  /** Supply a synthetic album request and its own saved date before Aula's navigation event. */
  const albumRequest = async (id: number, checkpoint?: string | null) => {
    const url = new URL(defaultGalleryUrl())

    url.searchParams.delete('userSpecificAlbum')

    url.searchParams.set('albumId', String(id))

    const key = await galleryKey(url.href)

    if (!checkpoints.has(key) || checkpoint !== undefined) {
      checkpoints.set(key, checkpoint ?? null)
    }

    resources.push({ name: url.href })
  }

  if (options.albumId !== undefined) {
    await albumRequest(options.albumId, options.checkpoint ?? null)
  }

  const checkpointFor = (key?: string) =>
    key !== undefined && checkpoints.has(key) ? checkpoints.get(key) ?? null : options.checkpoint ?? null

  let hold = false

  let currentRun:
    | {
      started: string
      key: string
      until: string
      cutoff: string | null
      cancelled: boolean
    }
    | undefined

  let galleryFailures = options.galleryFailures ?? 0

  Object.defineProperty(window.crypto, 'subtle', { value: crypto.subtle })

  Object.assign(window, { TextEncoder, AbortController, AbortSignal, Date })

  Object.defineProperty(window.performance, 'getEntriesByType', {
    value: () => resources,
  })

  Object.assign(window, {
    chrome: {
      runtime: {
        sendMessage: async (request: {
          type: string
          started?: string
          until?: string
          cutoff?: string | null
          key?: string
          runId?: string
          media?: { filename: string }
        }) => {
          messages.push(request)

          if (request.type === 'gallery' && holdNextSummary) {
            holdNextSummary = false

            const checkpoint = checkpointFor(request.key)

            await new Promise<void>((resolve) => {
              releaseSummary = resolve
            })

            return { checkpoint }
          }

          if (request.type === 'gallery' && galleryFailures > 0) {
            galleryFailures--

            return Promise.resolve({ error: 'operation' })
          }

          if (options.error !== undefined && options.error !== '' && request.type === 'gallery') {
            return Promise.resolve({ error: options.error })
          }

          if (request.type === 'process' && options.holdProcessing) {
            await new Promise<void>((resolve) => {
              releaseProcess = resolve
            })
          }

          if (options.processError !== undefined && options.processError !== '' && request.type === 'process') {
            return Promise.resolve({ error: options.processError })
          }

          if (request.type === 'finish') {
            const key = currentRun?.key

            if (
              currentRun
              && !currentRun.cancelled
              && (options.processError ?? '') === ''
              && currentRun.until >= currentRun.started
              && (currentRun.cutoff === null
                || currentRun.cutoff <= currentRun.started)
            ) {
              if (checkpoints.has(currentRun.key)) {
                checkpoints.set(currentRun.key, currentRun.started)
              }
              else {
                options.checkpoint = currentRun.started
              }
            }

            currentRun = undefined

            return Promise.resolve({ checkpoint: checkpointFor(key) })
          }

          if (request.type === 'begin') {
            currentRun = { ...request, cancelled: false } as typeof currentRun

            return Promise.resolve({ runId: `synthetic-run-${++runNumber}` })
          }

          if (request.type === 'cancel' && currentRun) {
            currentRun.cancelled = true
          }

          return Promise.resolve(
            request.type === 'gallery'
              ? { checkpoint: checkpointFor(request.key) }
              : { mode: 'processed' },
          )
        },
      },
    },
    fetch: async (input: string, fetchOptions: { signal: AbortSignal }) => {
      if (hold) {
        return new Promise((_resolve, reject) => {
          fetchOptions.signal.addEventListener(
            'abort',
            () => {
              reject(
                fetchOptions.signal.reason instanceof Error
                  ? fetchOptions.signal.reason
                  : new Error('Aborted'),
              )
            },
            { once: true },
          )
        })
      }

      const index = Number(new URL(input).searchParams.get('index'))

      const albumId = new URL(input).searchParams.get('albumId')

      const version = Number(required(/\d+/.exec(new URL(input).pathname))[0])

      if (version < (options.apiVersion ?? CONFIG.aula.apiVersion)) {
        return new Response(null, { status: 410 })
      }

      return new Response(
        wireJSON({
          version,
          data: {
            startIndex: index,
            album: albumId === null ? null : { name: `Synthetic Album ${albumId}` },
            results: options.incompatibleApi
              ? 'changed'
              : index || options.empty
                ? []
                : fixture.data.results.slice(0, options.items ?? 1).map(item => ({
                    ...item,
                    file: {
                      ...item.file,
                      name: albumId === null ? item.file.name : `synthetic-album-${albumId}-${item.id}.jpeg`,
                    },
                  })),
          },
        }),
      )
    },
  })

  required(window.document.getElementById('launcher')).focus()

  window.eval(bundle)

  const host = required(window.document.getElementById(CONFIG.browser.panelId))

  const shadow = required(host.shadowRoot)

  await until(
    () =>
      !!shadow.getElementById('toggle')
      && !shadow.querySelector('.MuiSkeleton-root'),
  )

  const query = (id: string) => shadow.getElementById(id)

  const element = (id: string) => required(query(id))

  return {
    dom,
    reopen: () => window.eval(bundle),
    window,
    messages,
    openAlbum: async (id: number, checkpoint?: string | null) => {
      await albumRequest(id, checkpoint)

      window.location.hash = `#/galleri/${id}`
    },
    finishProcessing: () => {
      options.holdProcessing = false

      required(releaseProcess)()
    },
    holdSummary: () => {
      holdNextSummary = true
    },
    finishSummary: async () => {
      required(releaseSummary)()

      await new Promise(resolve => setTimeout(resolve, 10))
    },
    host,
    element,
    query,
    click: async (id: string) => click(element(id)),
    change: async (id: string, value: string) =>
      changeInput(window, element(id) as HTMLInputElement, value),
    hold: () => {
      hold = true
    },
  }
}
