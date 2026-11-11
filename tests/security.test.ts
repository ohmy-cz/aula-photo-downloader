import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CONFIG } from '../src/config'
import { required } from '../src/required'
import {
  begin,
  complete,
  jobs,
  key,
  media,
  message,
  pendingJob,
  ready,
  reset,
  sessionStore,
  store,
  url,
} from './helpers/background'
import { panel, until } from './helpers/panel'

void test('Aula DOM clicks cannot start privileged downloads', async () => {
  const view = await panel(['en'], { empty: true })

  const count = view.messages.length;

  (view.element('toggle') as HTMLButtonElement).click()

  await new Promise(resolve => setTimeout(resolve, 10))

  assert.equal(view.messages.length, count)

  await view.click('toggle')

  await until(() => view.messages.some(entry => entry.type === 'begin'))
})

void test('Private active data stays in trusted session storage and opted-out tags are discarded', async () => {
  reset()

  const runId = required((await begin({ childTags: false })).runId)

  await message({ type: 'process', runId, media: media() })

  assert.deepEqual(pendingJob().job.media.children, [])

  assert(required(pendingJob().job.media.url).includes('Signature'))

  assert(!JSON.stringify(store).includes('Signature'))

  assert(!JSON.stringify(store).includes('Synthetic Child A'))

  assert.equal(
    (
      await message({
        type: 'process',
        runId,
        media: { ...media(), url: 'https://evil.test/1.jpg' },
      })
    ).error,
    'operation',
  )

  await message(
    { type: 'worker-ready', id: pendingJob().job.id, error: 'media-fetch' },
    { id: 'test-extension', url: url('offscreen.html') },
  )

  assert.equal(jobs.size, 0)
})

void test('Removed native requests are rejected and only the packaged popup can clear saved dates', async () => {
  reset()

  for (const type of ['repair', 'file-dates', 'tools', 'checkpoint']) {
    assert.equal((await message({ type, key })).error, 'operation')
  }

  const runId = required((await begin()).runId)

  await message({ type: 'process', runId, media: media() })

  await ready()

  const popup = { id: 'test-extension', url: url(CONFIG.browser.popupPage) }

  assert.equal((await message({ type: 'clear-history' }, popup)).ok, false)

  await complete(1)

  await message({ type: 'finish', runId })

  const downloads = structuredClone([...jobs])

  assert.equal((await message({ type: 'clear-history' }, popup)).ok, true)

  assert.deepEqual([...jobs], downloads)

  assert.deepEqual(store, {})

  assert.deepEqual(sessionStore, {})
})

void test('Damaged active media is discarded without exposing a URL or advancing its import date', async () => {
  reset()

  const runId = required((await begin()).runId)

  await message({ type: 'process', runId, media: media() })

  pendingJob().job.media.url = 'https://evil.test/private'

  assert.equal((await message({ type: 'gallery', key })).checkpoint, null)

  assert.equal(sessionStore[CONFIG.archive.runStorageKey], undefined)

  assert.equal((await message({ type: 'finish', runId })).error, 'file-retry')

  assert.equal(jobs.size, 0)
})
