import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CONFIG } from '../src/config'
import { required } from '../src/required'
import {
  activeRun,
  begin,
  closedTabs,
  complete,
  jobs,
  key,
  media,
  message,
  pendingJob,
  ready,
  removed,
  reset,
  sender,
  sessionStore,
  store,
} from './helpers/background'

void test('Session recovery finds a lost Chrome ID and counts its completed receipt once', async () => {
  reset()

  const runId = required((await begin()).runId)

  const result = await message({ type: 'process', runId, media: media() })

  await ready()

  const pending = pendingJob()

  assert.equal(pending.stage, 'downloading')

  delete pending.downloadId

  // Simulate suspension during the ID write: Chrome already completed the one accepted download.
  required(jobs.get(1)).state = 'complete'

  assert.equal(
    (await message({ type: 'status', operation: result.operation })).mode,
    'processed',
  )

  assert.equal(activeRun().completed, 1)

  assert.equal(jobs.size, 1)

  await message({ type: 'finish', runId })
})

void test('Stop and owner-tab closure keep active downloads safe and prevent cross-tab takeover', async () => {
  reset()

  const runId = required((await begin()).runId)

  await message({ type: 'process', runId, media: media() })

  await ready()

  sessionStore[`${CONFIG.archive.activationStorageKey}:2`] = true

  const other = { ...sender, tab: { id: 2 } }

  assert.equal(
    (await message({ type: 'cancel', runId }, other)).error,
    'file-retry',
  )

  assert.equal((await begin()).error, 'worker-busy')

  closedTabs.add(1)

  for (const handler of removed) {
    handler(1)
  }

  await message({ type: 'gallery', key }, other)

  assert(activeRun().cancelled)

  assert.equal(jobs.size, 1)

  await complete(1)

  assert.equal(
    (await message({ type: 'finish', runId }, { ...sender })).error,
    'activation-required',
  )

  const next = await message(
    {
      type: 'begin',
      key,
      name: 'Synthetic Restarted',
      expected: 0,
      childTags: false,
      started: '2026-01-01',
      until: '2026-01-01',
      cutoff: null,
    },
    other,
  )

  assert(next.runId !== undefined)

  assert.equal(
    (await message({ type: 'gallery', key }, other)).checkpoint,
    null,
  )
})

void test('Downloads wait a full second after confirmed completion across successive operations', async (t) => {
  reset()

  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1800000000000 })

  const runId = required((await begin({ expected: 2 })).runId)

  await message({ type: 'process', runId, media: media() })

  await ready()

  await complete(1)

  await message({ type: 'process', runId, media: { ...media(), id: 2 } })

  const next = ready()

  await new Promise(resolve => setImmediate(resolve))

  t.mock.timers.tick(999)

  await new Promise(resolve => setImmediate(resolve))

  assert.equal(jobs.size, 1)

  t.mock.timers.tick(1)

  await next

  assert.equal(jobs.size, 2)
})

void test('Incompatible tracking resets without converting old records or changing existing downloads', async () => {
  for (const schema of [1, 2, 3, 5]) {
    reset()

    await begin({ expected: 0 })

    store[CONFIG.archive.storageKey] = {
      schema,
      galleries: { [key]: { records: {}, checkpoint: '2020-01-01' } },
    }

    store[`${CONFIG.archive.storageKey}:entry:old`] = { filename: 'old.jpg' }

    const downloads = structuredClone([...jobs])

    assert.equal((await message({ type: 'gallery', key })).checkpoint, null)

    assert.deepEqual(store, {
      [CONFIG.archive.storageKey]: { schema: 4, checkpoints: {} },
    })

    assert.equal(sessionStore[CONFIG.archive.runStorageKey], undefined)

    assert.deepEqual([...jobs], downloads)
  }
})
