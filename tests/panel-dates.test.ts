import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CONFIG } from '../src/config'
import { archiveZoneDay } from '../src/metadata/dates'
import { required } from '../src/required'
import { panel, until } from './helpers/panel'

void test('Modeless panel restores the saved cutoff, returns focus on Escape and reopens once', async () => {
  const state = await panel(['en'], { checkpoint: '2020-01-01' })

  assert.equal(required(state.host.shadowRoot).activeElement?.id, 'toggle')

  assert.equal((state.element('all') as HTMLInputElement).checked, false)

  assert.equal(
    (state.element('cutoff') as HTMLInputElement).value,
    '2020-01-01',
  )

  state.element('toggle').dispatchEvent(
    new state.window.KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      composed: true,
    }),
  )

  assert(state.host.hidden)

  assert.equal(state.window.document.activeElement?.id, 'launcher')

  state.reopen()

  assert(!state.host.hidden)

  assert.equal(
    state.window.document.querySelectorAll(`#${CONFIG.browser.panelId}`).length,
    1,
  )

  assert.equal(required(state.host.shadowRoot).activeElement?.id, 'toggle')

  await until(
    () => (state.element('cutoff') as HTMLInputElement).value === '2020-01-01',
  )
})

void test('A successful import restores its checkpoint in a new page session', async () => {
  const options = { empty: true, checkpoint: '2020-01-01' }

  const state = await panel(['en'], options)

  await state.click('toggle')

  await until(
    () => state.element('phase').textContent === 'Finished · ready to upload',
  )

  assert.equal(options.checkpoint, archiveZoneDay())

  assert.equal(
    (state.element('cutoff') as HTMLInputElement).value,
    options.checkpoint,
  )

  state.dom.window.close()

  const reopened = await panel(['en'], options)

  assert.equal(
    (reopened.element('cutoff') as HTMLInputElement).value,
    options.checkpoint,
  )

  assert.equal((reopened.element('all') as HTMLInputElement).checked, false)

  assert.equal(
    (reopened.element('cutoff') as HTMLInputElement).disabled,
    false,
  )
})

void test('Historical imports and stopped collection preserve the last successful checkpoint', async () => {
  const options = { empty: true, checkpoint: '2020-01-01' }

  const state = await panel(['en'], options);

  (state.element('today') as HTMLInputElement).click()

  await new Promise(resolve => setTimeout(resolve, 0))

  await state.change('latest', '2020-01-02')

  await state.click('toggle')

  await until(
    () => state.element('phase').textContent === 'Finished · ready to upload',
  )

  assert.equal(options.checkpoint, '2020-01-01')

  state.hold()

  await state.click('toggle')

  await until(() => state.element('phase').textContent === 'Collecting data')

  await state.click('toggle')

  await until(() => !(state.element('toggle') as HTMLButtonElement).disabled)

  assert.equal(options.checkpoint, '2020-01-01')
})

void test('An import opened before Copenhagen midnight saves the submission day across both DST transitions', async (context) => {
  for (const [instant, expected] of [
    ['2026-03-28T22:59:59Z', '2026-03-29'],
    ['2026-03-29T00:59:59Z', '2026-03-29'],
    ['2026-10-25T00:59:59Z', '2026-10-25'],
    ['2026-10-25T22:59:59Z', '2026-10-26'],
  ]) {
    context.mock.timers.enable({
      apis: ['Date'],
      now: Date.parse(required(instant)),
    })

    const options = { empty: true, checkpoint: '2020-01-01' }

    const state = await panel(['en'], options)

    try {
      context.mock.timers.tick(1000)

      await state.click('toggle')

      await until(
        () =>
          state.element('phase').textContent === 'Finished · ready to upload',
      )

      assert.equal(options.checkpoint, expected)

      assert.equal(
        (state.element('latest') as HTMLInputElement).value,
        expected,
      )

      assert.equal(
        (state.element('cutoff') as HTMLInputElement).value,
        expected,
      )
    }
    finally {
      state.dom.window.close()

      context.mock.timers.reset()
    }
  }
})
