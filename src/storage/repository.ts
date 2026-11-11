import type { ErrorCode } from '../errors'
import type { State } from '../types'
import { z } from 'zod'
import { CONFIG, STORAGE_KEY } from '../config'
import { AppError, ERROR_MESSAGES } from '../errors'
import { validatedMedia } from '../messages'
import { validDay } from '../security'
import { GalleryKey, PositiveId, StoredFilename } from '../validation'

const schemaVersion = CONFIG.archive.schemaVersion as State['schema']

const Day = z.custom<string>(validDay)

const History = z.strictObject({
  schema: z.literal(schemaVersion),
  checkpoints: z.record(GalleryKey, Day),
})

const Job = z.object({
  id: z.uuid(),
  filename: StoredFilename,
  media: z.unknown().transform((input, context) => {
    try {
      return validatedMedia(input)
    }
    catch {
      context.addIssue({ code: 'custom', message: 'Invalid active media.' })

      return z.NEVER
    }
  }),
})

const RunInput = z
  .object({
    id: z.uuid(),
    tabId: PositiveId,
    key: GalleryKey,
    folder: StoredFilename,
    started: Day,
    cutoff: Day.nullable(),
    until: Day,
    expected: z.number().int().min(0).max(CONFIG.limits.collectionItems),
    completed: z.number().int().min(0),
    childTags: z.boolean(),
    failed: z.boolean(),
    cancelled: z.boolean(),
    operation: z
      .object({
        jobId: z.uuid(),
        mediaId: PositiveId,
        result: z.literal('processed').optional(),
        error: z
          .custom<ErrorCode>(
            value =>
              typeof value === 'string' && Object.hasOwn(ERROR_MESSAGES, value),
          )
          .optional(),
        pending: z
          .discriminatedUnion('stage', [
            z.object({
              stage: z.literal('processing'),
              started: z.number(),
              job: Job,
            }),
            z.object({
              stage: z.literal('downloading'),
              started: z.number(),
              job: Job,
              blobUrl: z
                .string()
                .refine(value =>
                  value.startsWith(`blob:${chrome.runtime.getURL('')}`),
                ),
              downloadId: PositiveId.optional(),
            }),
          ])
          .optional(),
      })
      .optional(),
  })
  .refine((run) => {
    const operation = run.operation

    return (
      run.completed <= run.expected
      && (!operation
        || ([operation.pending, operation.result, operation.error].filter(Boolean).length === 1
          && (!operation.pending
            || (operation.jobId === operation.pending.job.id
              && operation.mediaId === operation.pending.job.media.id))))
    )
  })

/** Read only current state. Incompatible data resets without conversion or touching Chrome downloads. */
export const loadHistory = async (): Promise<State> => {
  const stored = await chrome.storage.local.get(null)

  const parsed = History.safeParse(stored[STORAGE_KEY])

  if (!parsed.success) {
    await chrome.storage.local.clear()

    const session = await chrome.storage.session.get(null)

    await chrome.storage.session.remove(
      Object.keys(session).filter(
        key => !key.startsWith(`${CONFIG.archive.activationStorageKey}:`),
      ),
    )

    await chrome.storage.local.set({
      [STORAGE_KEY]: { schema: CONFIG.archive.schemaVersion, checkpoints: {} },
    })
  }

  const history = parsed.success
    ? parsed.data
    : { schema: schemaVersion, checkpoints: {} }

  const transient = await chrome.storage.session.get(
    CONFIG.archive.runStorageKey,
  )

  const run = RunInput.safeParse(transient[CONFIG.archive.runStorageKey])

  if (!run.success && transient[CONFIG.archive.runStorageKey] !== undefined) {
    await chrome.storage.session.remove(CONFIG.archive.runStorageKey)
  }

  return { ...history, ...(run.success ? { run: run.data } : {}) }
}

/** Save transient processing state only; signed URLs and child names never enter persistent history. */
export const saveRun = async (state: State): Promise<void> => {
  try {
    if (state.run) {
      await chrome.storage.session.set({
        [CONFIG.archive.runStorageKey]: state.run,
      })
    }
    else {
      await chrome.storage.session.remove(CONFIG.archive.runStorageKey)
    }
  }
  catch {
    throw new AppError('storage-write')
  }
}

/** Commit only completed import dates. Callers serialize this with receipt finalization. */
export const saveCheckpoint = async (state: State): Promise<void> => {
  try {
    await chrome.storage.local.set({
      [STORAGE_KEY]: { schema: state.schema, checkpoints: state.checkpoints },
    })
  }
  catch (error) {
    throw new AppError(
      error instanceof Error && /quota/i.test(error.message)
        ? 'storage-quota'
        : 'storage-write',
    )
  }
}

/** Clear extension-owned state after the background has excluded active work; keep downloaded files. */
export const clearHistory = async (): Promise<void> => {
  await chrome.storage.local.clear()

  await chrome.storage.session.clear()
}
