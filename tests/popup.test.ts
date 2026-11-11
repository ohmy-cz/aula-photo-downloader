import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CONFIG } from '../src/config'
import { required } from '../src/required'
import en from '../src/ui/locales/en.json'
import { extensionPage } from './helpers/extension-page'
import { until } from './helpers/panel'

const tabs = {
  query: async () =>
    Promise.resolve([
      {
        id: 1,
        url: `${CONFIG.aula.origin}/portal/${CONFIG.aula.myMediaRoute}`,
      },
    ]),
}

void test('Opening an album activates and injects the downloader automatically, then waits for confirmed injection', async () => {
  const session: Record<string, unknown> = {}

  let injected = 0

  let finish: (() => void) | undefined

  const view = await extensionPage('popup', {
    tabs: {
      query: async () => [{ id: 1, url: `${CONFIG.aula.origin}/portal/#/galleri/12345` }],
    },
    storage: {
      session: {
        set: async (value: object) => Promise.resolve(Object.assign(session, value)),
      },
    },
    scripting: {
      executeScript: async () => {
        assert.equal(session[`${CONFIG.archive.activationStorageKey}:1`], true)

        injected++

        return new Promise<void>((resolve) => {
          finish = resolve
        })
      },
    },
  })

  await until(() => injected === 1)

  await until(() => view.window.document.querySelector('h2')?.textContent === en.popupReadyHeading)

  assert.equal(view.window.document.querySelector('h2')?.textContent, en.popupReadyHeading)

  assert.equal(view.element('message').textContent, en.popupReadyMessage)

  assert.equal(view.window.document.getElementById('consent'), null)

  assert.equal(view.window.document.querySelector('input[type="checkbox"]'), null)

  assert((view.element('clear-history') as HTMLButtonElement).disabled)

  assert(!view.closed())

  required(finish)()

  await until(view.closed)
})

void test('Failed automatic injection keeps the popup open and permits a trusted retry', async () => {
  let injected = 0

  const view = await extensionPage('popup', {
    tabs,
    storage: { session: { set: async () => Promise.resolve() } },
    scripting: {
      executeScript: async () => {
        if (++injected === 1) {
          throw new Error('Page unavailable')
        }
      },
    },
  })

  await until(() => view.element('message').textContent.includes('Refresh'))

  await until(() => !(view.element('continue') as HTMLButtonElement).disabled)

  assert(!view.closed())

  assert.equal((view.element('continue') as HTMLButtonElement).disabled, false)

  ;(view.element('continue') as HTMLButtonElement).click()

  assert.equal(injected, 1)

  await view.click('continue')

  await until(view.closed)

  assert.equal(injected, 2)
})

void test('History clearing reports an active download and permits retry after completion', async () => {
  let ok = false

  let clears = 0

  const view = await extensionPage('popup', {
    tabs: {
      query: async () => [{ id: 1, url: `${CONFIG.aula.origin}/portal/#/galleri` }],
    },
    runtime: {
      sendMessage: async () => {
        clears++

        return Promise.resolve({ ok })
      },
    },
  })

  await until(() => !(view.element('clear-history') as HTMLButtonElement).disabled);

  (view.element('clear-history') as HTMLButtonElement).click()

  assert.equal(clears, 0)

  await view.click('clear-history')

  await until(() => view.element('message').textContent === en.historyBusy)

  assert.equal(view.element('message').textContent, en.historyBusy)

  ok = true

  await view.click('clear-history')

  await until(() => view.element('message').textContent === en.historyCleared)

  assert.equal(view.element('message').textContent, en.historyCleared)

  assert(!view.closed())
})

void test('Gallery overview keeps album guidance and history controls without injecting a downloader', async () => {
  const view = await extensionPage('popup', {
    tabs: {
      query: async () => [{ id: 1, url: `${CONFIG.aula.origin}/portal/#/galleri` }],
    },
  })

  await until(() => !(view.element('clear-history') as HTMLButtonElement).disabled)

  assert.equal(view.window.document.querySelector('h2')?.textContent, en.popupHeading)

  assert.equal(view.element('message').textContent, en.popupMessage)

  assert(required(view.element('continue').parentElement).hidden)

  assert.equal(view.window.document.getElementById('consent'), null)
})
