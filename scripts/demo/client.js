import { sleep } from '../../src/async'
import { CONFIG } from '../../src/config'

const session = new URL(location.href).searchParams.get('fresh') || 'default'

const storageKey = `apd-dates-demo-${session}`

const activity = document.getElementById('activity')

let run = null

let operation = null

let completedAt = 0

/** Exercise the real bundled worker on synthetic media, then discard its temporary resources. */
const processFixture = async (media) => {
  const extension
    = media.kind === 'video' ? 'mp4' : media.id === 2 ? 'png' : 'jpg'

  const bytes = await (
    await fetch(`/fixtures/sample.${extension}`)
  ).arrayBuffer()

  const worker = new Worker(`/${CONFIG.browser.workerScript}`, {
    type: 'module',
  })

  try {
    await new Promise((resolve, reject) => {
      worker.onmessage = event =>
        event.data.bytes ? resolve() : reject(new Error('Worker failed'))

      worker.onerror = reject

      worker.postMessage({ id: String(media.id), media, bytes }, [bytes])
    })
  }
  finally {
    worker.terminate()
  }
}

/** Simulate one confirmed download without storing media receipts or touching real files. */
const simulateDownload = async (media) => {
  const current = operation

  try {
    await sleep(
      Math.max(0, completedAt + CONFIG.timing.downloadGapMs - Date.now()),
    )

    if (document.getElementById('slow').checked) {
      await sleep(CONFIG.timing.downloadGapMs * 3)
    }

    if (document.getElementById('fail').checked) {
      throw new Error('Synthetic failure')
    }

    await processFixture(media)

    current.result = { mode: 'processed' }

    run.completed++

    completedAt = Date.now()
  }
  catch {
    current.result = { error: 'worker-unavailable' }

    run.failed = true

    activity.textContent = 'Worker failure; no file downloaded'
  }
}

/** Emulate the run protocol using dates-only demo storage and one in-memory operation. */
const handleMessage = async (message) => {
  const checkpoint = () => localStorage.getItem(storageKey)

  switch (message.type) {
    case 'gallery':
      return { checkpoint: checkpoint() }

    case 'begin':
      run = {
        ...message,
        id: crypto.randomUUID(),
        completed: 0,
        failed: false,
        cancelled: false,
      }

      operation = null

      return { runId: run.id }

    case 'process':
      operation = { runId: run.id, jobId: crypto.randomUUID(), result: null }

      activity.textContent = `Processing: ${message.media.filename}`

      void simulateDownload({ ...message.media, children: run.childTags ? message.media.children : [] })

      return {
        mode: 'working',
        operation: { runId: run.id, jobId: operation.jobId },
      }

    case 'status':
      return (
        operation.result ?? {
          mode: 'working',
          operation: { runId: run.id, jobId: operation.jobId },
        }
      )

    case 'cancel':
      run.cancelled = true

      return { ok: true }

    case 'finish':
      if (
        !run.failed
        && !run.cancelled
        && run.completed === run.expected
        && run.until >= run.started
        && (run.cutoff === null || run.cutoff <= run.started)
      ) {
        localStorage.setItem(storageKey, run.started)
      }

      run = operation = null

      return { checkpoint: checkpoint() }
  }
}

window.chrome = {
  runtime: { getURL: path => `/${path}`, sendMessage: handleMessage },
}

// Redirect only the synthetic gallery API; all media fixtures and WASM remain local.
const nativeFetch = window.fetch.bind(window)

/** Optionally retire the implemented API locally to exercise newer-version compatibility and its warning. */
window.fetch = (url, options) => {
  if (!String(url).startsWith(`${CONFIG.aula.origin}/api/`)) {
    return nativeFetch(url, options)
  }

  const request = new URL(url)

  request.searchParams.set('requestVersion', request.pathname.match(/\d+/)[0])

  request.searchParams.set(
    'newerApi',
    new URL(location.href).searchParams.get('newerApi') || '0',
  )

  return nativeFetch(`/demo-api?${request.searchParams}`, options)
}
