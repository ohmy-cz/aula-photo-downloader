import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CONFIG } from '../src/config'
import { loadConnection, saveConnection } from '../src/immich/settings'
import { api, begin, message, reset, sender } from './helpers/background'

void test('Album creation validates the server contract, limits the payload to a private empty album and requires the activated saved connection', async (t) => {
  reset()

  Object.assign(api, { permissions: { contains: async () => true } })

  t.after(() => {
    Reflect.deleteProperty(api, 'permissions')

    reset()
  })

  const connection = { id: crypto.randomUUID(), server: 'https://immich.example.test', apiKey: 'synthetic-key', lastAlbumId: null }

  await saveConnection(connection)

  const album = { id: crypto.randomUUID(), albumName: 'Synthetic new album', albumThumbnailAssetId: null, createdAt: '2000-01-01T12:00:00Z', albumUsers: [{ user: { id: crypto.randomUUID() }, role: 'owner' }] }

  const input = { type: 'immich-create-album', connectionId: connection.id, name: ` ${album.albumName} ` }

  let status = 201

  let responseBody: unknown = album

  let calls = 0

  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    calls++

    assert.equal(url, `${connection.server}/api/albums`)

    assert.equal(init.method, 'POST')

    assert.deepEqual(JSON.parse(String(init.body)), { albumName: album.albumName })

    assert.equal(new Headers(init.headers).get('x-api-key'), connection.apiKey)

    assert.equal(init.credentials, 'omit')

    assert.equal(init.redirect, 'error')

    return Response.json(responseBody, { status })
  })

  assert.equal((await message(input, { ...sender, tab: { id: 2 } })).error, 'activation-required')

  assert.equal((await message({ ...input, connectionId: crypto.randomUUID() })).error, 'immich-config')

  for (const name of ['', '   ', 'x'.repeat(CONFIG.limits.nameCharacters + 1)]) {
    assert.equal((await message({ ...input, name })).error, 'operation')
  }

  assert.equal(calls, 0)

  const result = await message(input)

  assert.deepEqual(result, { id: album.id, name: album.albumName, thumbnailId: null })

  assert(!JSON.stringify(result).includes(connection.apiKey))

  status = 403

  assert.equal((await message(input)).error, 'immich-auth')

  assert.equal(calls, 2)

  status = 201

  responseBody = { ...album, id: 'invalid' }

  assert.equal((await message(input)).error, 'immich-contract')

  await begin()

  assert.equal((await message(input)).error, 'worker-busy')

  assert.equal(calls, 3)

  assert.deepEqual(await loadConnection(), connection)
})
