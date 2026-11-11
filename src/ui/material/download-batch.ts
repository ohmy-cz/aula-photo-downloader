import type { Summary } from '../../types'
import { collectMediaQueue } from '../../api'
import { CONFIG } from '../../config'
import { request, waitForOperation } from '../client'
import { t, translateError } from '../i18n'

export interface BatchProgress {
  phase: 'collecting' | 'processing' | 'finished' | 'stopped' | 'error'
  total: number
  totalKnown: boolean
  completed: number
  failures: number
}

/** Collect before beginning a run; Stop awaits its current receipt, and partial runs never advance dates. */
export const downloadBatch = async (options: {
  key: string
  url: string
  cutoff: string | null
  until: string
  childTags: boolean
  signal: AbortSignal
  batch: BatchProgress
  started: string
  progress: () => void
  status: (text: string, error?: boolean) => void
  apiVersion: (version: number) => void
  fileError: (id: number, filename: string, reason: string) => void
  checkpoint: (day: string) => void
}) => {
  const { signal, batch } = options

  let name = CONFIG.aula.myMediaName

  const queue = await collectMediaQueue(options.url, {
    signal,
    cutoff: options.cutoff,
    until: options.until,
    onApiVersion: options.apiVersion,
    onAlbum: (value) => {
      name = value
    },
    onCollected: (count) => {
      batch.total = count

      options.progress()
    },
  })

  signal.throwIfAborted()

  const { runId } = await request<{ runId: string }>({
    type: 'begin',
    key: options.key,
    name,
    started: options.started,
    cutoff: options.cutoff,
    until: options.until,
    expected: queue.length,
    childTags: options.childTags,
  })

  const cancel = () => {
    void request({ type: 'cancel', runId }).catch(() => undefined)
  }

  signal.addEventListener('abort', cancel, { once: true })

  try {
    batch.phase = 'processing'

    batch.totalKnown = true

    options.status(t('processing'))

    options.progress()

    for (const media of queue) {
      signal.throwIfAborted()

      options.status(media.filename)

      try {
        if (media.url === null || media.url === '') {
          throw new Error(t('errors.original-unavailable'))
        }

        await waitForOperation(
          { type: 'process', runId, media },
          t('errors.operation-timeout'),
        )

        batch.completed++
      }
      catch (error) {
        batch.failures++

        options.fileError(media.id, media.filename, translateError(error))

        options.status(translateError(error), true)
      }

      options.progress()
    }
  }
  finally {
    queue.length = 0

    signal.removeEventListener('abort', cancel)

    if (signal.aborted || batch.failures) {
      await request({ type: 'cancel', runId })
    }

    const summary = await request<Summary>({ type: 'finish', runId })

    if (summary.checkpoint !== null) {
      options.checkpoint(summary.checkpoint)
    }
  }

  if (!batch.failures && !signal.aborted) {
    batch.phase = 'finished'

    options.status(t('finishedReady'))
  }
  else {
    options.status(
      signal.aborted
        ? t('stoppedSaved')
        : t('retry', { count: batch.failures }),
      !signal.aborted,
    )
  }
}
