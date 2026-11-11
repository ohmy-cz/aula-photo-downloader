import assert from 'node:assert/strict'
import { test } from 'node:test'
import { required } from '../src/required'
import en from '../src/ui/locales/en.json'
import fixture from './fixtures/aula/gallery-v25.json'
import { panel, until } from './helpers/panel'

void test('Reopening clears a previous startup error when gallery refresh succeeds', async () => {
  const options = { error: 'operation' }

  const state = await panel(['en'], options)

  await until(() => state.element('phase').classList.contains('error'))

  options.error = '';

  (state.element('close') as HTMLButtonElement).click()

  state.reopen()

  await until(() => !state.element('phase').classList.contains('error'))

  assert.equal(state.element('phase').textContent, '')
})

void test('File errors accumulate above selection and retries update the existing row', async () => {
  const state = await panel(['en'], { processError: 'media-timeout' })

  // Keep real collection pacing deterministic within the fixture's settle window.
  state.window.Math.random = () => 0

  assert.equal(state.element('file-errors').hidden, true)

  for (let attempt = 0; attempt < 2; attempt++) {
    await state.click('toggle')

    await until(() => state.element('toggle').textContent === 'Start')

    assert.equal(
      state.element('phase').textContent,
      '1 file needs attention · press Start to retry',
    )

    assert.equal(state.element('file-error-list').children.length, 1)

    assert(
      state
        .element('file-error-list')
        .textContent.includes(required(fixture.data.results[0]).file.name),
    )

    assert(
      state
        .element('file-error-list')
        .textContent.includes('Browser processing timed out'),
    )
  }
})

void test('Navigation during collection aborts and refreshes the new gallery after settling', async () => {
  const state = await panel()

  state.hold()

  await state.click('toggle')

  await until(() => state.element('toggle').textContent === 'Stop')

  const initial = state.messages.length

  state.window.location.hash = '#/galleri/minemedier?new-session=1'

  await until(
    () =>
      state.element('toggle').textContent === 'Start'
      && state.messages
        .slice(initial)
        .some(message => message.type === 'gallery'),
  )

  assert.equal((state.element('all') as HTMLInputElement).checked, true)

  assert.equal((state.element('toggle') as HTMLButtonElement).disabled, false)
})

void test('Public errors are displayed safely without exposing unknown payloads', async () => {
  for (const error of ['api-login', 'private signed URL']) {
    const state = await panel(['en'], { error })

    await until(() => !!state.element('phase').textContent)

    assert.equal(
      state.element('phase').textContent,
      error === 'api-login' ? en.errors['api-login'] : en.errors.operation,
    )
  }
})

void test('Completed counts and saved dates belong to the selected album, including navigation through the overview', async () => {
  const state = await panel(['en'], { albumId: 1001 })

  state.window.Math.random = () => 0

  await state.click('toggle')

  await until(() => state.element('phase').textContent === en.finishedReady)

  assert.equal(state.element('count').textContent, '1 of 1 complete · 0 left')

  const checkpoint = (state.element('cutoff') as HTMLInputElement).value

  state.window.location.hash = '#/galleri'

  await until(() => state.element('count').textContent === '')

  assert(state.element('download-progress').hidden)

  await state.openAlbum(1002, '1999-01-01')

  await until(() => (state.element('cutoff') as HTMLInputElement).value === '1999-01-01')

  assert.equal(state.element('count').textContent, '')

  assert.equal(state.element('phase').textContent, '')

  assert.equal((state.element('all') as HTMLInputElement).checked, false)

  await state.openAlbum(1001)

  await until(() => (state.element('cutoff') as HTMLInputElement).value === checkpoint)

  assert.equal(state.element('count').textContent, '')

  await state.openAlbum(1002)

  await until(() => (state.element('cutoff') as HTMLInputElement).value === '1999-01-01')

  await state.click('toggle')

  await until(() => state.element('phase').textContent === en.finishedReady)

  assert.equal(state.element('count').textContent, '1 of 1 complete · 0 left')

  const runs = state.messages.filter(message => message.type === 'begin')

  assert.equal(new Set(runs.map(run => run.key)).size, 2)

  assert.deepEqual(state.messages.filter(message => message.type === 'process').map(message => message.media?.filename), [
    'synthetic-album-1001-1000.jpeg',
    'synthetic-album-1002-1000.jpeg',
  ])
})

void test('A different album clears file failures and API warnings from the previous album', async () => {
  const options = { albumId: 1001, apiVersion: 26, processError: 'media-timeout' }

  const state = await panel(['en'], options)

  state.window.Math.random = () => 0

  await state.click('toggle')

  await until(() => state.element('failures').textContent === '1 file needs attention')

  assert.equal(state.element('file-error-list').children.length, 1)

  assert.equal(state.element('api-warning').hidden, false)

  options.apiVersion = 25

  await state.openAlbum(1002)

  await until(() => !(state.element('toggle') as HTMLButtonElement).disabled && state.element('count').textContent === '')

  assert.equal(state.element('phase').textContent, '')

  assert.equal(state.element('failures').textContent, '')

  assert.equal(state.element('file-error-list').children.length, 0)

  assert(state.element('file-errors').hidden)

  assert(state.element('api-warning').hidden)
})

for (const processError of ['', 'media-timeout']) {
  void test(`Switching albums cancels the old queue and ignores its late ${processError ? 'failure' : 'receipt'}`, async () => {
    const options = { albumId: 1001, items: 2, holdProcessing: true, processError }

    const state = await panel(['en'], options)

    state.window.Math.random = () => 0

    await state.click('toggle')

    await until(() => state.messages.some(message => message.type === 'process'))

    assert.equal(state.element('count').textContent, '0 of 2 complete · 2 left')

    const oldRun = required(state.messages.find(message => message.type === 'process')).runId

    await state.openAlbum(1002, '1999-01-01')

    await until(() => state.element('count').textContent === '')

    assert((state.element('toggle') as HTMLButtonElement).disabled)

    assert.equal(state.messages.filter(message => message.type === 'process').length, 1)

    state.finishProcessing()

    await until(() => !(state.element('toggle') as HTMLButtonElement).disabled)

    assert.equal(state.element('phase').textContent, '')

    assert.equal(state.element('count').textContent, '')

    assert.equal(state.element('failures').textContent, '')

    assert.equal(state.element('file-error-list').children.length, 0)

    assert.equal((state.element('cutoff') as HTMLInputElement).value, '1999-01-01')

    assert(state.messages.some(message => message.type === 'cancel' && message.runId === oldRun))

    options.processError = ''

    await state.click('toggle')

    await until(() => state.element('phase').textContent === en.finishedReady)

    assert.equal(state.element('count').textContent, '2 of 2 complete · 0 left')

    const files = state.messages.filter(message => message.type === 'process')

    assert.equal(files.length, 3)

    assert(files.slice(1).every(message => message.runId !== oldRun && message.media?.filename.startsWith('synthetic-album-1002-')))

    await state.openAlbum(1001)

    await until(() => !(state.element('toggle') as HTMLButtonElement).disabled && state.element('count').textContent === '')

    assert.equal((state.element('all') as HTMLInputElement).checked, true, 'Cancelled album imports must not advance their saved date')

    assert.equal(state.element('count').textContent, '')
  })
}

void test('A late checkpoint reply for the previous album cannot overwrite the selected album dates', async () => {
  const state = await panel(['en'], { albumId: 1001, checkpoint: '2000-01-01' })

  state.holdSummary()

  const before = state.messages.filter(message => message.type === 'gallery').length

  state.reopen()

  await until(() => state.messages.filter(message => message.type === 'gallery').length > before)

  await state.openAlbum(1002, '1999-01-01')

  await until(() => (state.element('cutoff') as HTMLInputElement).value === '1999-01-01')

  await state.finishSummary()

  assert.equal((state.element('cutoff') as HTMLInputElement).value, '1999-01-01')

  assert.equal((state.element('all') as HTMLInputElement).checked, false)

  assert.equal(state.element('count').textContent, '')

  assert.equal(state.element('phase').textContent, '')
})
