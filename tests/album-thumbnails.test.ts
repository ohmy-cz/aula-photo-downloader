import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { CONFIG } from '../src/config'
import { saveConnection } from '../src/immich/settings'
import { required } from '../src/required'
import { api, key, message, reset, sender } from './helpers/background'

void test('Thumbnail proxy binds credentials to the saved server, enforces activation and bounds, and does not block the transfer queue', { timeout: 5000 }, async (t) => {
  reset()

  const permissions = { contains: async () => true }

  Object.assign(api, { permissions })

  t.after(() => {
    Reflect.deleteProperty(api, 'permissions')
  })

  const connection = { id: crypto.randomUUID(), server: 'https://immich.example.test', apiKey: 'synthetic-key', lastAlbumId: null }

  await saveConnection(connection)

  const bytes = await readFile(new URL('fixtures/sample.png', import.meta.url))

  const assetId = crypto.randomUUID()

  const input = { type: 'immich-thumbnail', destination: { connectionId: connection.id, albumId: crypto.randomUUID() }, assetId }

  let respond = () => new Response(bytes, { headers: { 'Content-Type': 'image/png' } })

  let calls = 0

  let release: (() => void) | undefined

  let hold = false

  let notifyStarted: (() => void) | undefined

  const started = new Promise<void>((resolve) => {
    notifyStarted = resolve
  })

  t.after(() => release?.())

  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    calls++

    assert.equal(url, `${connection.server}/api/assets/${assetId}/thumbnail?size=thumbnail`)

    assert.equal(new Headers(init.headers).get('x-api-key'), connection.apiKey)

    assert.equal(init.credentials, 'omit')

    assert.equal(init.redirect, 'error')

    assert.equal(init.cache, 'no-store')

    if (hold) {
      await new Promise<void>((resolve) => {
        release = resolve

        required(notifyStarted)()
      })
    }

    return respond()
  })

  assert.equal((await message(input, { ...sender, tab: { id: 2 } })).error, 'activation-required')

  assert.equal((await message({ ...input, destination: { ...input.destination, connectionId: crypto.randomUUID() } })).error, 'immich-config')

  assert.equal((await message({ ...input, assetId: 'https://other.example.test/synthetic/image' })).error, 'operation')

  assert.equal(calls, 0)

  const result = await message(input)

  assert.deepEqual(Buffer.from(required(result.src).split(',')[1] ?? '', 'base64'), bytes)

  assert(!JSON.stringify(result).includes(connection.apiKey))

  respond = () => new Response('<svg />', { headers: { 'Content-Type': 'image/svg+xml' } })

  assert.equal((await message(input)).error, 'immich-contract')

  respond = () => new Response(bytes, { headers: { 'Content-Type': 'image/png', 'Content-Length': String(CONFIG.limits.immichThumbnailBytes + 1) } })

  assert.equal((await message(input)).error, 'immich-contract')

  respond = () => new Response(null, { status: 403 })

  assert.equal((await message(input)).error, 'immich-auth')

  hold = true

  const pending = message(input)

  await started

  await message({ type: 'gallery', key })

  required(release)()

  await pending
})
