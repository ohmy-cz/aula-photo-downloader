import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CONFIG } from '../src/config'
import { archiveZoneDay } from '../src/metadata/dates'
import { required } from '../src/required'
import {
  access,
  activeRun,
  begin,
  complete,
  filenames,
  jobs,
  key,
  media,
  message,
  ready,
  reset,
  sessionStore,
  store,
  stored,
} from './helpers/background'

void test('A complete run saves only its date, and a same-day import downloads originals again with collision suffixes', async () => {
  reset()

  for (let attempt = 0; attempt < 2; attempt++) {
    const runId = required((await begin()).runId)

    const result = await message({ type: 'process', runId, media: media() })

    assert.equal(result.mode, 'working')

    assert.equal(access, 'TRUSTED_CONTEXTS')

    assert(!JSON.stringify(store).includes('Signature'))

    assert(!JSON.stringify(store).includes('Synthetic Child A'))

    await ready()

    const suggestion = await new Promise<
      chrome.downloads.FilenameSuggestion | undefined
    >(resolve =>
      required(filenames[0])(
        {
          byExtensionId: 'test-extension',
          url: required(jobs.get(attempt + 1)).url,
        },
        resolve,
      ),
    )

    assert.equal(
      required(suggestion).filename,
      'aula-photo-downloader/Test album/20260430_095302.jpg',
    )

    assert.equal(
      (await message({ type: 'status', operation: result.operation })).mode,
      'working',
    )

    await complete(attempt + 1)

    for (let poll = 0; poll < 2; poll++) {
      assert.equal(
        (await message({ type: 'status', operation: result.operation })).mode,
        'processed',
      )
    }

    assert.equal(activeRun().completed, 1)

    assert(!activeRun().operation?.pending)

    assert.equal(
      (await message({ type: 'finish', runId })).checkpoint,
      archiveZoneDay(),
    )

    assert.equal(sessionStore[CONFIG.archive.runStorageKey], undefined)
  }

  assert.deepEqual(store, {
    [CONFIG.archive.storageKey]: {
      schema: 4,
      checkpoints: { [key]: archiveZoneDay() },
    },
  })

  assert.equal(jobs.size, 2)

  assert(required(jobs.get(2)).filename.endsWith('20260430_095302 (1).jpg'))
})

void test('Failed processing exposes a file error, produces no fallback download, and blocks checkpoint advancement', async () => {
  reset()

  const runId = required((await begin()).runId)

  const result = await message({ type: 'process', runId, media: media() })

  const jobId = activeRun().operation?.jobId

  await message(
    { type: 'worker-ready', id: jobId, error: 'media-timeout' },
    {
      id: 'test-extension',
      url: 'chrome-extension://test-extension/offscreen.html',
    },
  )

  assert.equal(
    (await message({ type: 'status', operation: result.operation })).error,
    'media-timeout',
  )

  assert.equal(jobs.size, 0)

  assert.equal((await message({ type: 'finish', runId })).checkpoint, null)

  assert.deepEqual(stored().checkpoints, {})
})

void test('Empty current batches advance dates; historical, incomplete and cancelled batches preserve them', async () => {
  reset()

  const initial = required((await begin({ expected: 0 })).runId)

  await message({ type: 'finish', runId: initial })

  const checkpoint = archiveZoneDay()

  for (const patch of [
    { expected: 0, until: '2020-01-01' },
    { expected: 2 },
    { expected: 0, cutoff: '2099-01-01', until: '2099-01-02' },
  ]) {
    const runId = required((await begin(patch)).runId)

    assert.equal(
      (await message({ type: 'finish', runId })).checkpoint,
      checkpoint,
    )
  }

  const runId = required((await begin({ expected: 0 })).runId)

  await message({ type: 'cancel', runId })

  assert.equal(
    (await message({ type: 'finish', runId })).checkpoint,
    checkpoint,
  )
})

void test('Album runs keep separate receipts, folders and checkpoints even when media IDs overlap', async () => {
  reset()

  const first = required((await begin()).runId)

  await message({ type: 'process', runId: first, media: media() })

  await ready()

  const otherKey = 'b'.repeat(64)

  const other = { key: otherKey, name: 'Synthetic Album B' }

  assert.equal((await begin(other)).error, 'worker-busy')

  await message({ type: 'cancel', runId: first })

  await complete(1)

  await message({ type: 'finish', runId: first })

  const second = required((await begin(other)).runId)

  assert.notEqual(first, second)

  assert.equal(activeRun().completed, 0)

  await message({ type: 'process', runId: second, media: media() })

  await ready()

  await complete(2)

  await message({ type: 'finish', runId: second })

  assert(required(jobs.get(1)).filename.includes('/Test album/'))

  assert(required(jobs.get(2)).filename.includes('/Synthetic Album B/'))

  assert.equal((await message({ type: 'gallery', key })).checkpoint, null)

  assert.equal((await message({ type: 'gallery', key: otherKey })).checkpoint, archiveZoneDay())
})
