import assert from 'node:assert/strict'
import { test } from 'node:test'
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
        return { connected: false, server: '' }
      }

      assert.equal(request.type, 'immich-connect')

      assert.equal(request.apiKey, 'synthetic')

      connections++

      await new Promise<void>((resolve) => {
        finish = resolve
      })

      return { connected: true, server: request.server }
    } },
  })

  await until(() => !(view.element('immich-connect') as HTMLButtonElement).disabled)

  for (const permission of ['user.read', 'album.read', 'asset.read', 'asset.upload', 'albumAsset.create']) {
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

  await until(() => view.element('connection-status').textContent.includes('Connected to'))

  assert.equal((view.element('immich-key') as HTMLInputElement).value, '')
})

void test('Denied Immich host permission preserves the settings form and never sends the API key to the background', async () => {
  let connections = 0

  const view = await extensionPage('options', {
    permissions: { request: async () => false },
    runtime: { sendMessage: async ({ type }: { type: string }) => {
      if (type === 'immich-status') {
        return { connected: false, server: '' }
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
