import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CONFIG } from '../src/config'
import { handleImmichRequest } from '../src/immich/requests'
import { connectionStatus, loadConnection, saveConnection } from '../src/immich/settings'
import { required } from '../src/required'
import en from '../src/ui/locales/en.json'
import { extensionPage } from './helpers/extension-page'
import { until } from './helpers/panel'

void test('Options show minimum Immich permissions, request the exact host and keep controls locked until verified connection storage succeeds', async () => {
  let finish: (() => void) | undefined

  let connections = 0

  const grants: string[][] = []

  const view = await extensionPage('options', {
    permissions: { request: async ({ origins }: { origins: string[] }) => {
      grants.push([...origins])

      return true
    } },
    runtime: { sendMessage: async (request: { type: string, server?: string, apiKey?: string }) => {
      if (request.type === 'immich-status') {
        return { connected: false, server: '', keyLength: 0 }
      }

      assert.equal(request.type, 'immich-connect')

      assert.equal(request.apiKey, ['synthetic', undefined, 'synthetic-replacement'][connections])

      assert.equal(Object.hasOwn(request, 'apiKey'), connections !== 1)

      connections++

      await new Promise<void>((resolve) => {
        finish = resolve
      })

      return { connected: true, server: request.server, keyLength: (request.apiKey ?? 'synthetic').length }
    } },
  })

  await until(() => !(view.element('immich-connect') as HTMLButtonElement).disabled)

  for (const permission of ['user.read', 'album.read', 'album.create', 'asset.read', 'asset.view', 'asset.upload', 'albumAsset.create']) {
    assert(view.window.document.body.textContent.includes(permission))
  }

  assert.equal((view.element('immich-key') as HTMLInputElement).type, 'password')

  await view.change('immich-server', 'https://immich.example.test/api/')

  await view.change('immich-key', 'synthetic')

  await view.submit()

  await until(() => connections === 1)

  assert.deepEqual(grants, [['https://immich.example.test/*']])

  assert((view.element('immich-connect') as HTMLButtonElement).disabled)

  assert((view.element('immich-server') as HTMLInputElement).disabled)

  assert.equal(view.element('connection-status').textContent, en.immichDisconnected)

  required(finish)()

  await until(() => !(view.element('immich-connect') as HTMLButtonElement).disabled)

  assert(view.element('connection-status').textContent.includes('Connected to'))

  assert.equal((view.element('immich-key') as HTMLInputElement).value, '*'.repeat('synthetic'.length))

  await view.submit()

  await until(() => connections === 2)

  required(finish)()

  await until(() => !(view.element('immich-connect') as HTMLButtonElement).disabled)

  await view.change('immich-key', 'synthetic-replacement')

  await view.submit()

  await until(() => connections === 3)

  required(finish)()

  await until(() => !(view.element('immich-connect') as HTMLButtonElement).disabled)

  assert.equal((view.element('immich-key') as HTMLInputElement).value, '*'.repeat('synthetic-replacement'.length))

  await view.change('immich-server', 'https://other.example.test')

  await view.submit()

  await until(() => view.window.document.body.textContent.includes(en.errors['immich-config']))

  assert.equal(connections, 3)

  assert.equal(grants.length, 3)
})

void test('Denied Immich host permission preserves the settings form and never sends the API key to the background', async () => {
  let connections = 0

  const view = await extensionPage('options', {
    permissions: { request: async () => false },
    runtime: { sendMessage: async ({ type }: { type: string }) => {
      if (type === 'immich-status') {
        return { connected: false, server: '', keyLength: 0 }
      }

      connections++
    } },
  })

  await until(() => !(view.element('immich-connect') as HTMLButtonElement).disabled)

  await view.change('immich-server', 'https://immich.example.test')

  await view.change('immich-key', 'synthetic')

  await view.submit()

  await until(() => view.window.document.body.textContent.includes(en.errors['immich-permission']))

  assert.equal(connections, 0)

  assert.equal((view.element('immich-key') as HTMLInputElement).value, 'synthetic')

  assert(!(view.element('immich-connect') as HTMLButtonElement).disabled)
})

void test('Saved keys reopen as stars and remain unchanged with their album choice; masks cannot send them to another server', async (t) => {
  const originalChrome = globalThis.chrome

  const storage: Record<string, unknown> = {}

  let apiKey = 'synthetic-key'

  let requests = 0

  Object.assign(globalThis, { chrome: {
    permissions: { contains: async () => true },
    storage: { local: {
      get: async () => structuredClone(storage),
      set: async (value: object) => { Object.assign(storage, structuredClone(value)) },
      remove: async (key: string) => { Reflect.deleteProperty(storage, key) },
    } },
  } })

  t.after(() => {
    Object.assign(globalThis, { chrome: originalChrome })
  })

  t.mock.method(globalThis, 'fetch', async (input: string, init: RequestInit) => {
    assert.equal(new URL(input).origin, 'https://immich.example.test')

    assert.equal(new Headers(init.headers).get('x-api-key'), apiKey)

    requests++

    return Response.json(input.endsWith('users/me') ? { id: crypto.randomUUID() } : [])
  })

  const state = { schema: 4 as const, checkpoints: {} }

  const server = 'https://immich.example.test'

  await handleImmichRequest(state, { type: 'immich-connect', server, apiKey }, true)

  const saved = { ...required(await loadConnection()), lastAlbumId: crypto.randomUUID() }

  await saveConnection(saved)

  assert.deepEqual(await connectionStatus(), { connected: true, server, keyLength: apiKey.length })

  const view = await extensionPage('options', { runtime: { sendMessage: async () => connectionStatus() } })

  await until(() => !(view.element('immich-connect') as HTMLButtonElement).disabled)

  assert.equal((view.element('immich-key') as HTMLInputElement).value, '*'.repeat(apiKey.length))

  assert(!view.window.document.documentElement.outerHTML.includes(apiKey))

  for (const input of [{ type: 'immich-connect', server }, { type: 'immich-connect', server, apiKey: '*'.repeat(apiKey.length) }]) {
    await handleImmichRequest(state, input, true)

    assert.deepEqual(await loadConnection(), saved)
  }

  const before = requests

  await assert.rejects(handleImmichRequest(state, { type: 'immich-connect', server: 'https://other.example.test' }, true), { code: 'immich-config' })

  assert.equal(requests, before)

  assert.deepEqual(await loadConnection(), saved)

  apiKey = 'synthetic-replacement-key'

  await handleImmichRequest(state, { type: 'immich-connect', server, apiKey }, true)

  assert.equal(required(await loadConnection()).apiKey, apiKey)

  assert.notEqual(required(await loadConnection()).id, saved.id)

  assert.equal((await connectionStatus()).keyLength, apiKey.length)

  assert.deepEqual(await handleImmichRequest(state, { type: 'immich-disconnect' }, true), { connected: false, server: '', keyLength: 0 })

  assert.equal(storage[CONFIG.immich.storageKey], undefined)
})
