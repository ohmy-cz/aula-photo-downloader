import assert from 'node:assert/strict'
import { test } from 'node:test'
import cs from '../src/ui/locales/cs.json'
import da from '../src/ui/locales/da.json'
import en from '../src/ui/locales/en.json'
import es from '../src/ui/locales/es.json'
import { panel, until } from './helpers/panel'

for (const [language, translations] of Object.entries({ cs, da, en, es })) {
  void test(`Newer API fallback keeps a translated warning visible through completion and reopening in ${language}`, async () => {
    const options = { empty: true, apiVersion: 26 }

    const state = await panel([language], options)

    assert.equal(state.element('api-warning').hidden, true)

    await state.click('toggle')

    await until(
      () =>
        state.element('toggle').textContent === translations.start
        && !state.element('api-warning').hidden,
    )

    const warning = state.element('api-warning')

    assert(warning.textContent.includes('v26'))

    assert(warning.textContent.includes('v25'))

    assert.equal(
      warning.textContent,
      translations.newerApiWarning
        .replace('{{version}}', '26')
        .replace('{{implementedVersion}}', '25'),
    )

    assert.equal(
      state.element('phase').textContent,
      translations.finishedReady,
    );

    (state.element('close') as HTMLButtonElement).click()

    state.reopen()

    assert.equal(warning.hidden, false)

    options.apiVersion = 25

    await state.click('toggle')

    await until(
      () =>
        warning.hidden
        && state.element('toggle').textContent === translations.start,
    )
  })
}

void test('An incompatible newer API blocks downloads and keeps the previous import date', async () => {
  const options = {
    empty: true,
    apiVersion: 26,
    incompatibleApi: true,
    checkpoint: '2020-01-01',
  }

  const state = await panel(['en'], options)

  await state.click('toggle')

  await until(() => state.element('phase').classList.contains('error'))

  assert.equal(
    state.element('phase').textContent,
    'Aula\'s response structure has changed. Update the extension before collecting.',
  )

  assert.equal(state.element('api-warning').hidden, true)

  assert.equal(options.checkpoint, '2020-01-01')

  assert(
    !state.messages.some(message =>
      ['process', 'begin', 'finish'].includes(message.type),
    ),
  )
})
