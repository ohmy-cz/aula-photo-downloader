import type { AlbumSelection, ImmichAlbum } from '../src/immich/contracts'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { required } from '../src/required'
import en from '../src/ui/locales/en.json'
import { panel, until } from './helpers/panel'

/** Invent album identities per scenario without storing server data or media. */
const albums = (): AlbumSelection => {
  const values = ['Synthetic summer', 'Synthetic winter', 'Synthetic café', 'Synthetic café'].map<ImmichAlbum>(name => ({ id: crypto.randomUUID(), name, thumbnailId: crypto.randomUUID() }))

  required(values[1]).thumbnailId = null

  return { connectionId: crypto.randomUUID(), selectedId: required(values[0]).id, albums: values }
}

void test('Album search preserves the remembered choice, handles duplicate/accented names and loads only visible covers before importing the chosen ID', async () => {
  const selection = albums()

  const view = await panel(['en'], { immich: selection, holdProcessing: true })

  view.window.Math.random = () => 0

  await view.click('toggle')

  await until(() => !!view.query('immich-album') && !(view.element('immich-album') as HTMLInputElement).disabled)

  assert.equal((view.element('immich-album') as HTMLInputElement).value, 'Synthetic summer')

  assert(!(view.element('immich-import') as HTMLButtonElement).disabled)

  await view.change('immich-album', 'cafe')

  const options = () => [...required(view.host.shadowRoot).querySelectorAll<HTMLElement>('[role="option"]')]

  await until(() => options().length === 2)

  assert(options().every(option => option.textContent === 'Synthetic café'))

  assert((view.element('immich-import') as HTMLButtonElement).disabled)

  assert.equal(view.messages.filter(message => message.type === 'immich-thumbnail').length, 0)

  view.revealCovers()

  await until(() => options().every(option => !!option.querySelector('img')))

  assert.deepEqual(view.messages.filter(message => message.type === 'immich-thumbnail').map(message => message.assetId).sort(), selection.albums.slice(2).map(album => album.thumbnailId).sort())

  await view.change('immich-album', 'winter')

  await until(() => options().length === 1)

  view.revealCovers()

  assert(!required(options()[0]).querySelector('img'))

  await view.change('immich-album', 'cafe')

  await until(() => options().length === 2)

  view.revealCovers()

  await until(() => options().every(option => !!option.querySelector('img')))

  assert.equal(view.messages.filter(message => message.type === 'immich-thumbnail').length, 2)

  await view.click(required(options()[1]).id)

  assert.equal((view.element('immich-album') as HTMLInputElement).value, 'Synthetic café')

  await view.click('immich-import')

  await until(() => view.messages.some(message => message.type === 'process'))

  assert.deepEqual({ ...view.messages.find(message => message.type === 'immich-select')?.destination }, { connectionId: selection.connectionId, albumId: required(selection.albums[3]).id })

  await until(() => !view.host.shadowRoot?.querySelector('[role="dialog"]'))

  assert((view.element('toggle') as HTMLButtonElement).disabled)

  assert((view.element('download-instead') as HTMLButtonElement).disabled)

  view.finishProcessing()

  await until(() => !(view.element('toggle') as HTMLButtonElement).disabled)

  assert.equal(view.element('phase').textContent, en.importFinished)

  assert(view.element('phase').querySelector('svg'))

  assert.equal(view.element('phase').parentElement, view.element('count').parentElement)

  assert(!(view.element('download-instead') as HTMLButtonElement).disabled)
})

void test('Collection uses a skeleton in the main panel; Stop settles the run and unlocks import without reopening the picker', async () => {
  const view = await panel(['da'], { immich: albums() })

  view.hold()

  await view.click('toggle')

  await until(() => !!view.query('immich-import') && !(view.element('immich-import') as HTMLButtonElement).disabled)

  await view.click('immich-import')

  await until(() => !view.host.shadowRoot?.querySelector('[role="dialog"]'))

  assert(view.element('download-progress').querySelector('.MuiSkeleton-root'))

  assert.equal(view.element('toggle').textContent, 'Vælg album og importér')

  assert((view.element('toggle') as HTMLButtonElement).disabled)

  assert((view.element('download-instead') as HTMLButtonElement).disabled)

  await view.click('stop')

  await until(() => !(view.element('toggle') as HTMLButtonElement).disabled)

  assert(!view.query('immich-album'))

  assert(view.element('download-progress').hidden)

  assert(!view.element('phase').querySelector('svg'))

  assert(!(view.element('download-instead') as HTMLButtonElement).disabled)
})

void test('A failed import stays in the main panel with its error and re-enabled actions', async () => {
  const view = await panel(['en'], { immich: albums(), processError: 'immich-auth' })

  view.window.Math.random = () => 0

  await view.click('toggle')

  await until(() => !!view.query('immich-import') && !(view.element('immich-import') as HTMLButtonElement).disabled)

  await view.click('immich-import')

  await until(() => view.messages.some(message => message.type === 'process') && !(view.element('toggle') as HTMLButtonElement).disabled)

  assert(!view.host.shadowRoot?.querySelector('[role="dialog"]'))

  assert(view.element('phase').classList.contains('error'))

  assert(view.element('file-error-list').textContent.includes(en.errors['immich-auth']))

  assert(!(view.element('download-instead') as HTMLButtonElement).disabled)
})

void test('Missing thumbnail permissions show a notice and placeholders while album selection stays usable', async () => {
  const view = await panel(['en'], { immich: albums(), thumbnailError: 'immich-auth' })

  await view.click('toggle')

  await until(() => !!view.query('immich-album') && !(view.element('immich-album') as HTMLInputElement).disabled)

  await view.change('immich-album', 'cafe')

  await until(() => !!view.host.shadowRoot?.querySelector('[role="option"]'))

  view.revealCovers()

  await until(() => !!view.host.shadowRoot?.textContent?.includes(en.immichThumbnailPermission))

  assert.equal(view.host.shadowRoot?.querySelector('[role="option"] img'), null)

  await view.click(required(view.host.shadowRoot?.querySelector<HTMLElement>('[role="option"]')).id)

  assert(!(view.element('immich-import') as HTMLButtonElement).disabled)
})

void test('Create from an empty picker, retaining the name on permission failure and selecting only the confirmed album before importing', async () => {
  const selection = { ...albums(), albums: [], selectedId: null }

  const created: ImmichAlbum = { id: crypto.randomUUID(), name: 'Synthetic new album', thumbnailId: null }

  let reply: ImmichAlbum | { error: string } = { error: 'immich-auth' }

  let finish: (() => void) | undefined

  let calls = 0

  const view = await panel(['en'], {
    immich: selection,
    createAlbum: async (name) => {
      assert.equal(name, created.name)

      calls++

      await new Promise<void>((resolve) => {
        finish = resolve
      })

      return reply
    },
  })

  view.window.Math.random = () => 0

  await view.click('toggle')

  await until(() => !!view.query('immich-create') && !(view.element('immich-create') as HTMLButtonElement).disabled)

  await view.click('immich-create')

  assert((view.element('immich-create-submit') as HTMLButtonElement).disabled)

  await view.change('immich-album-name', created.name)

  await view.submit('immich-create-form')

  await until(() => calls === 1)

  for (const id of ['immich-create-submit', 'immich-create-cancel', 'immich-album-name', 'immich-import']) {
    assert((view.element(id) as HTMLInputElement).disabled)
  }

  required(finish)()

  await until(() => !!view.host.shadowRoot?.textContent?.includes(en.immichCreatePermission))

  assert.equal((view.element('immich-album-name') as HTMLInputElement).value, created.name)

  assert(!view.query('immich-album'))

  reply = created

  await view.submit('immich-create-form')

  await until(() => calls === 2)

  required(finish)()

  await until(() => !!view.query('immich-album') && !view.query('immich-create-form'))

  assert.equal((view.element('immich-album') as HTMLInputElement).value, created.name)

  await view.click('immich-import')

  await until(() => view.messages.some(message => message.type === 'immich-select'))

  assert.equal(view.messages.find(message => message.type === 'immich-select')?.destination?.albumId, created.id)

  await until(() => !view.host.shadowRoot?.querySelector('[role="dialog"]'))
})
