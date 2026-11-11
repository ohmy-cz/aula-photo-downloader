import assert from 'node:assert/strict'
import { test } from 'node:test'
import { collectMediaQueue } from '../src/api'
import { CONFIG, defaultGalleryUrl } from '../src/config'
import { required } from '../src/required'
import fixture from './fixtures/aula/gallery-v25.json'
import { wireJSON } from './fixtures/aula/mock'

/** Generate distinct synthetic records while preserving the reviewed v25 fixture structure. */
const syntheticMedia = (count: number) => {
  const template = required(fixture.data.results[0])

  return Array.from({ length: count }, (_, index) => ({
    ...template,
    id: 1000 + index,
    file: {
      ...template.file,
      id: 1000 + index,
      name: `synthetic-${index}.jpeg`,
      key: `synthetic/${index}.jpeg`,
      url: `${CONFIG.aula.mediaOrigin}/synthetic/${index}.jpeg?Signature=synthetic`,
    },
  }))
}

interface Page {
  results: ReturnType<typeof syntheticMedia>
  startIndex?: number
}

/** Exercise the actual collector, transport and DTO validation against synthetic paginated Aula responses. */
const collection = (readPage: (index: number) => Page) => {
  const url = new URL(defaultGalleryUrl())

  url.searchParams.delete('userSpecificAlbum')

  url.searchParams.set('albumId', '1001')

  url.searchParams.append('filterInstProfileIds[]', '101')

  url.searchParams.append('filterInstProfileIds[]', '102')

  // Aula may already be displaying a later page when the user opens the downloader.
  url.searchParams.set('index', '12')

  url.searchParams.set('limit', '12')

  const requests: URL[] = []

  const result = collectMediaQueue(url.href, {
    cutoff: null,
    signal: AbortSignal.timeout(5000),
    delay: 0,
    onCollected: () => {},
    fetch: async (input) => {
      const request = new URL(String(input))

      requests.push(request)

      const index = Number(request.searchParams.get('index'))

      return new Response(wireJSON({
        data: {
          album: { name: 'Synthetic Album' },
          // A stale total must not truncate an otherwise valid collection.
          mediaCount: 1,
          totalSize: 1,
          limit: 12,
          startIndex: index,
          ...readPage(index),
        },
      }))
    },
  })

  return { requests, result }
}

void test('Aula pagination collects all 25 files across full and partial pages, preserving album and profile filters', async () => {
  const media = syntheticMedia(25)

  const pages = new Map([
    [0, media.slice(0, 12)],
    [12, media.slice(12, 24)],
    [24, media.slice(24)],
    [25, []],
  ])

  const { requests, result } = collection(index => ({ results: required(pages.get(index)) }))

  const queue = await result

  assert.deepEqual(requests.map(url => url.searchParams.get('index')), ['0', '12', '24', '25'])

  assert.deepEqual(queue.map(item => item.id), media.map(item => item.id))

  assert.deepEqual(queue.map(item => item.position), Array.from({ length: 25 }, (_, index) => index + 1))

  for (const url of requests) {
    assert.equal(url.searchParams.get('method'), CONFIG.aula.mediaMethod)

    assert.equal(url.searchParams.get('albumId'), '1001')

    assert.deepEqual(url.searchParams.getAll('filterInstProfileIds[]'), ['101', '102'])

    assert.equal(url.searchParams.get('limit'), '12')
  }
})

void test('Short overlapping Aula pages advance by their actual length and collect each media ID once', async () => {
  const media = syntheticMedia(3)

  const pages = new Map([
    [0, media.slice(0, 2)],
    [2, media.slice(1)],
    [4, []],
  ])

  const { requests, result } = collection(index => ({ results: required(pages.get(index)) }))

  assert.deepEqual((await result).map(item => item.id), media.map(item => item.id))

  assert.deepEqual(requests.map(url => url.searchParams.get('index')), ['0', '2', '4'])
})

void test('Repeated Aula pages stop with a pagination error instead of returning a partial download queue', async () => {
  const media = syntheticMedia(12)

  const { requests, result } = collection(() => ({ results: media }))

  await assert.rejects(result, { code: 'api-pagination' })

  assert.equal(requests.length, CONFIG.aula.maxRepeatedPages + 1)
})

void test('An Aula response for the wrong offset fails before any further pages are collected', async () => {
  const { requests, result } = collection(index => ({
    results: syntheticMedia(12),
    startIndex: index + 12,
  }))

  await assert.rejects(result, { code: 'api-pagination' })

  assert.equal(requests.length, 1)
})
