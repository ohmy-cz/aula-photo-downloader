import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { startFixtureServers } from './browser/fixtures.mjs'
import { createBrowserHarness } from './browser/harness.mjs'
import { buildExtension } from './lib/build.mjs'
import { until } from './lib/wait.mjs'

/** Verify both engines and restart recovery in one disposable installed-extension scenario. */
const verifyBrowser = async () => {
  assert(
    process.env.CHROME_PATH,
    'Set CHROME_PATH to a Chrome for Testing executable.',
  )

  const directory = await mkdtemp(join(tmpdir(), 'aula-browser-'))

  const extension = join(directory, 'extension')

  const settings = JSON.parse(await readFile('config.json', 'utf8'))

  let browser, environment

  try {
    environment = await startFixtureServers(directory, settings)

    const scenario = environment.state

    settings.timing.pageDelayMinMs = settings.timing.pageDelayMaxMs = 0

    settings.timing.pollMs = 100

    await buildExtension(settings, extension, false)

    const driver = await createBrowserHarness(settings, directory, extension)

    browser = driver.browser

    const { control, workerURL, worker, inject, state, click, waitPanel }
      = driver

    let page = driver.getPage()

    await page.bringToFront()

    await control.evaluate(() => chrome.action.openPopup())

    await waitPanel('toggle', 'Start')

    assert.equal(await page.evaluate(id => document.getElementById(id).shadowRoot.getElementById('child-tags').checked, settings.browser.panelId), true)

    await page.evaluate(id => document.getElementById(id).shadowRoot.getElementById('child-tags').click(), settings.browser.panelId)

    assert.equal(await page.evaluate(id => document.getElementById(id).shadowRoot.getElementById('child-tags').checked, settings.browser.panelId), true)

    await click('child-tags')

    assert.equal(await page.evaluate(id => document.getElementById(id).shadowRoot.getElementById('child-tags').checked, settings.browser.panelId), false)

    scenario.holdMedia = true

    await click()

    await until(() => scenario.heldResponse, 'worker fetching original')

    assert.equal((await state()).run.childTags, false)

    assert.deepEqual((await state()).run.operation.pending.job.media.children, [])

    await waitPanel('phase', 'camera-1.jpg')

    await waitPanel('count', '0 of 2 complete · 2 left')

    await click()

    scenario.holdMedia = false

    scenario.heldResponse.end(await readFile('tests/fixtures/sample.jpg'))

    scenario.heldResponse = null

    await waitPanel('toggle', 'Start')

    await waitPanel('count', '1 of 2 complete · 1 left')

    assert.equal(
      (await control.evaluate(() => chrome.downloads.search({}))).length,
      1,
    )

    assert.deepEqual((await state()).checkpoints, {})

    await click()

    await waitPanel('phase', 'Finished · ready to upload')

    await waitPanel('count', '2 of 2 complete · 0 left')

    const finished = await state()

    const [key] = Object.keys(finished.checkpoints)

    assert(key)

    assert(!finished.run)

    const receipts = (
      await control.evaluate(() => chrome.downloads.search({}))
    ).sort((a, b) => a.id - b.id)

    assert.equal(
      receipts.length,
      3,
      'Restarting a stopped batch downloads its completed boundary files again',
    )

    assert.deepEqual(
      receipts.map(item => item.filename.split(/[\\/]/).pop()),
      ['camera-1.jpg', 'camera-1 (1).jpg', 'camera-2.mp4'],
    )

    for (let index = 1; index < receipts.length; index++) {
      assert(
        Date.parse(receipts[index].startTime)
        - Date.parse(receipts[index - 1].endTime)
        >= settings.timing.downloadGapMs,
        'Downloads must be spaced after completion',
      )
    }

    await page.emulateMediaFeatures([
      { name: 'prefers-reduced-motion', value: 'reduce' },
    ])

    const reducedMotion = await page.evaluate((id) => {
      const panel = document.getElementById(id).shadowRoot

      return Array.from(panel.querySelectorAll('#download-progress, #download-progress *'), element => ({
        animation: getComputedStyle(element).animationName,
        transition: getComputedStyle(element).transitionDuration,
      }))
    }, settings.browser.panelId)

    assert(reducedMotion.length > 0)

    assert(
      reducedMotion.every(
        ({ animation, transition }) =>
          animation === 'none' && transition === '0s',
      ),
    )

    await page.emulateMediaFeatures([])

    await until(
      () =>
        control.evaluate(
          async () =>
            (
              await chrome.runtime.getContexts({
                contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
              })
            ).length === 0,
        ),
      'idle offscreen document closed',
    )

    // Seed only session state for the lost-ID window, using a real completed Chrome receipt.
    const history = receipts[0]

    assert((await readFile(history.filename)).byteLength > 0)

    await control.evaluate(
      async (runKey, galleryKey, history, origin, aulaOrigin) => {
        const [tab] = await chrome.tabs.query({ url: `${aulaOrigin}/*` })

        const id = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'

        await chrome.storage.session.set({
          [runKey]: {
            id,
            tabId: tab.id,
            key: galleryKey,
            folder: 'Test album',
            started: '2026-04-30',
            cutoff: null,
            until: '2026-04-30',
            expected: 1,
            completed: 0,
            childTags: false,
            destination: null,
            failed: false,
            cancelled: false,
            operation: {
              jobId: id,
              mediaId: 1,
              pending: {
                started: Date.parse(history.startTime) - 1000,
                stage: 'downloading',
                blobUrl: history.url,
                job: {
                  id,
                  filename: 'camera-1.jpg',
                  media: {
                    id: 1,
                    filename: 'camera-1.jpg',
                    position: 1,
                    order: 'desc',
                    day: '2026-04-30',
                    kind: 'photo',
                    children: [],
                    size: null,
                    url: `${origin}/media/1.jpg`,
                    capture: null,
                  },
                },
              },
            },
          },
        })
      },
      settings.archive.runStorageKey,
      key,
      history,
      settings.aula.mediaOrigin,
      settings.aula.origin,
    )

    const workerCDP = await page.createCDPSession()

    let versions = []

    workerCDP.on('ServiceWorker.workerVersionUpdated', (event) => {
      versions = event.versions
    })

    await workerCDP.send('ServiceWorker.enable')

    const version = await until(
      () =>
        versions.find(
          version =>
            version.scriptURL === workerURL
            && version.runningStatus === 'running',
        ),
      'running service worker',
    )

    await workerCDP.send('ServiceWorker.stopWorker', {
      versionId: version.versionId,
    })

    await until(
      () => !browser.targets().includes(worker),
      'service worker stopped',
    )

    await inject()

    await until(async () => {
      const restored = await state()

      return restored.run?.completed === 1 && !restored.run.operation.pending
    }, 'receipt recovered after service-worker suspension')

    assert.equal(
      (await control.evaluate(() => chrome.downloads.search({}))).length,
      3,
      'Recovery must not duplicate a Chrome download',
    )

    await page.close()

    page = await driver.openGallery()

    await inject()

    await until(
      async () => !(await state()).run,
      'closed batch discarded without resume',
    )

    await waitPanel('toggle', 'Start')

    // Persisted cutoffs exclude the old synthetic uploads; exercise full-history retries explicitly.
    await click('all')

    scenario.unavailableOriginal = true

    await click()

    await waitPanel('phase', '1 file needs attention · press Start to retry')

    await waitPanel('count', '1 of 2 complete · 1 left')

    await waitPanel('phase', '1 file needs attention · press Start to retry')

    await waitPanel('failures', '1 file needs attention')

    scenario.unavailableOriginal = false

    await waitPanel('toggle', 'Start')

    await click()

    await waitPanel('phase', 'Finished · ready to upload')

    await waitPanel('count', '2 of 2 complete · 0 left')

    scenario.emptyGallery = true

    await waitPanel('toggle', 'Start')

    await click()

    await waitPanel('count', '0 of 0 complete · 0 left')

    await waitPanel('phase', 'Finished · ready to upload')

    scenario.emptyGallery = false

    scenario.collectionFailure = true

    await waitPanel('toggle', 'Start')

    await click()

    await waitPanel('toggle', 'Start')

    await waitPanel(
      'phase',
      'Aula is temporarily unavailable. Try again later.',
    )

    await waitPanel('count', '2 files found')

    assert.equal(
      await page.evaluate(
        id =>
          document
            .getElementById(id)
            .shadowRoot
            .getElementById('download-progress')
            .getAttribute('aria-valuenow'),
        settings.browser.panelId,
      ),
      null,
    )

    scenario.collectionFailure = false

    scenario.holdCollection = true

    await click()

    await until(
      () => scenario.heldGalleryResponse,
      'collection waiting for the last page',
    )

    await waitPanel('phase', 'Collecting data')

    await click()

    await waitPanel('toggle', 'Start')

    await waitPanel('phase', 'Stopped · completed downloads were kept')

    await waitPanel('count', '2 files found')

    scenario.heldGalleryResponse.destroy()

    scenario.heldGalleryResponse = null

    scenario.holdCollection = false

    scenario.apiVersion = settings.aula.apiVersion + 1

    await click()

    await waitPanel('phase', 'Finished · ready to upload')

    await waitPanel('count', '2 of 2 complete · 0 left')

    const warning = await page.evaluate((id) => {
      const field = document
        .getElementById(id)
        .shadowRoot
        .getElementById('api-warning')

      return { hidden: field.hidden, text: field.textContent }
    }, settings.browser.panelId)

    assert.equal(warning.hidden, false)

    assert(warning.text.includes(`v${scenario.apiVersion}`))

    assert(warning.text.includes('unexpected bugs'))

    assert.equal(
      (await control.evaluate(() => chrome.downloads.search({}))).length,
      8,
      'Only submitted successful files create downloads; re-imports intentionally create collision copies',
    )

    console.log(
      'Chrome extension: collection before processing, original filenames, download spacing, progress/error/empty states, reduced motion, Stop/Start and worker recovery passed.',
    )
  }
  finally {
    await browser?.close()

    await environment?.close()

    await rm(directory, { recursive: true, force: true })
  }
}

await verifyBrowser()
