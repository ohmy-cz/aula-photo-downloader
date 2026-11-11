import type { Run, State } from '../types'
import { z } from 'zod'
import { CONFIG } from '../config'
import { processMedia } from '../downloads/coordinator'
import { operationStatus } from '../downloads/operations'
import { AppError } from '../errors'
import { Destination } from '../immich/contracts'
import { connected, destinationKey, loadConnection, requireConnection } from '../immich/settings'
import { validatedMedia } from '../messages'
import { archiveZoneDay } from '../metadata/dates'
import { object, safeName, validateKey, validDay } from '../security'
import { saveCheckpoint, saveRun } from '../storage/repository'

/** Bind every run operation to its original Aula tab and opaque ID. */
const authorizedRun = (state: State, id: unknown, tabId: number): Run => {
  if (!state.run || state.run.id !== id || state.run.tabId !== tabId) {
    throw new AppError('file-retry')
  }

  return state.run
}

/** Dispatch after sender checks and receipt recovery; callers serialize all mutations. */
export const handlePageRequest = async (
  state: State,
  message: Record<string, unknown>,
  tabId: number,
) => {
  if (message.type === 'gallery') {
    validateKey(message.key)

    const connection = await loadConnection()

    const ready = await connected(connection)

    const destination = Object.hasOwn(message, 'destination')
      ? Destination.nullable().parse(message.destination)
      : ready && connection?.lastAlbumId != null ? { connectionId: connection.id, albumId: connection.lastAlbumId } : null

    if (destination) {
      await requireConnection(destination)
    }

    const key = await destinationKey(message.key, destination)

    return {
      checkpoint: !Object.hasOwn(message, 'destination') && ready && connection?.lastAlbumId == null ? null : state.checkpoints[key] ?? null,
      ...(connection ? { immichConnected: ready } : {}),
    }
  }

  if (message.type === 'begin') {
    validateKey(message.key)

    if (state.run) {
      const owner = await chrome.tabs
        .get(state.run.tabId)
        .catch(() => undefined)

      if (!owner) {
        state.run.cancelled = true
      }

      if (!state.run.cancelled || state.run.operation?.pending) {
        throw new AppError('worker-busy')
      }
    }

    const name = z
      .string()
      .trim()
      .min(1)
      .max(CONFIG.limits.nameCharacters)
      .parse(message.name)

    const expected = z
      .number()
      .int()
      .min(0)
      .max(CONFIG.limits.collectionItems)
      .parse(message.expected)

    if (
      !validDay(message.started)
      || message.started > archiveZoneDay()
      || !validDay(message.until)
      || (message.cutoff !== null
        && (!validDay(message.cutoff) || message.cutoff > message.until))
    ) {
      throw new AppError('cutoff-invalid')
    }

    const destination = message.destination == null ? null : Destination.parse(message.destination)

    if (destination) {
      const connection = await requireConnection(destination)

      if (connection.lastAlbumId !== destination.albumId) {
        throw new AppError('immich-album')
      }
    }

    state.run = {
      id: crypto.randomUUID(),
      tabId,
      key: await destinationKey(message.key, destination),
      folder: safeName(name),
      started: message.started,
      cutoff: message.cutoff,
      until: message.until,
      expected,
      completed: 0,
      childTags: z.boolean().parse(message.childTags),
      destination,
      failed: false,
      cancelled: false,
    }

    await saveRun(state)

    return { runId: state.run.id }
  }

  const operation
    = message.type === 'status' ? object(message.operation) : message

  const run = authorizedRun(state, operation.runId, tabId)

  if (message.type === 'status') {
    if (run.operation?.jobId !== operation.jobId) {
      throw new AppError('file-retry')
    }

    return operationStatus(run)
  }

  if (message.type === 'process') {
    const media = object(message.media)

    return processMedia(state, validatedMedia({
      ...media,
      children: run.childTags ? media.children : [],
    }))
  }

  if (message.type === 'cancel') {
    run.cancelled = true

    await saveRun(state)

    return { ok: true }
  }

  if (run.operation?.pending) {
    throw new AppError('worker-busy')
  }

  if (
    !run.cancelled
    && !run.failed
    && run.completed === run.expected
    && run.until >= run.started
    && (run.cutoff === null || run.cutoff <= run.started)
  ) {
    const previous = state.checkpoints[run.key]

    state.checkpoints[run.key]
      = previous !== undefined && previous > run.started ? previous : run.started

    await saveCheckpoint(state)
  }

  const checkpoint = state.checkpoints[run.key] ?? null

  delete state.run

  await saveRun(state)

  return { checkpoint }
}
