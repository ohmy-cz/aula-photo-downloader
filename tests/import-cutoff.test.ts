import assert from 'node:assert/strict'
import { test } from 'node:test'
import { collectMediaQueue } from '../src/api'
import { defaultGalleryUrl } from '../src/config'
import { required } from '../src/required'
import fixture from './fixtures/aula/gallery-v25.json'
import { wireJSON } from './fixtures/aula/mock'

for (const [date, before, boundary, after, cutoff] of [
  ['midnight', '20260429_235959', '20260430_000000', '20260430_000001', '2026-04-29T22:00:00Z'],
  ['spring DST transition', '20260329_015959', '20260329_030000', '20260329_030001', '2026-03-29T01:00:00Z'],
  ['autumn DST transition', '20261025_025959', '20261025_030000', '20261025_030001', '2026-10-25T02:00:00Z'],
]) {
  void test(`Immich capture cutoff silently excludes only older photos across the Copenhagen ${date}`, async () => {
    const template = required(fixture.data.results[0])

    const results = [before, boundary, after, before].map((name, index) => ({
      ...template,
      id: index + 1,
      mediaType: index === 3 ? 'video' : 'image',
      file: { ...template.file, name: `${name}.${index === 3 ? 'mp4' : 'jpg'}` },
    }))

    const collected: number[] = []

    const queue = await collectMediaQueue(defaultGalleryUrl(), {
      cutoff: null,
      photoCutoff: cutoff,
      delay: 0,
      signal: new AbortController().signal,
      fetch: async input => new Response(wireJSON({ data: { startIndex: Number(new URL(String(input)).searchParams.get('index')), results: new URL(String(input)).searchParams.get('index') === '0' ? results : [] } })),
      onCollected: count => collected.push(count),
    })

    assert.deepEqual(queue.map(item => item.id), [2, 3, 4])

    assert.deepEqual(collected, [1, 2, 3])
  })
}
