import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import puppeteer from 'puppeteer-core'

/** Own a disposable extension browser and expose UI actions bound to its current synthetic gallery tab. */
export const createBrowserHarness = async (settings, directory, extension) => {
  const origin = settings.aula.origin

  let browser

  try {
    // Programmatic injection has no toolbar gesture to grant activeTab access.
    // Grant only the disposable synthetic gallery origin in this test bundle.
    const testManifestPath = join(extension, 'manifest.json')

    const testManifest = JSON.parse(await readFile(testManifestPath, 'utf8'))

    testManifest.host_permissions.push(`${origin}/*`)

    await writeFile(testManifestPath, JSON.stringify(testManifest))

    await writeFile(
      join(extension, 'test-control.html'),
      '<!doctype html><title>Extension test control</title>',
    )

    // CDP's "allow" override bypasses Chrome's extension filename suggestions.
    // Use normal download handling with a directory confined to this test profile.
    await mkdir(join(directory, 'profile', 'Default'), { recursive: true })

    await writeFile(
      join(directory, 'profile', 'Default', 'Preferences'),
      JSON.stringify({
        intl: { accept_languages: 'en-GB,en' },
        download: {
          default_directory: join(directory, 'downloads'),
          prompt_for_download: false,
        },
      }),
    )

    browser = await puppeteer.launch({
      executablePath: process.env.CHROME_PATH,
      headless: true,
      enableExtensions: true,
      acceptInsecureCerts: true,
      userDataDir: join(directory, 'profile'),
      args: [
        '--ignore-certificate-errors',
        ...(process.env.CI === 'true' ? ['--no-sandbox'] : []),
      ],
    })

    const extensionId = await browser.installExtension(extension)

    const workerURL = `chrome-extension://${extensionId}/background.js`

    const worker = await browser.waitForTarget(
      target =>
        target.type() === 'service_worker' && target.url() === workerURL,
    )

    const cdp = await browser.target().createCDPSession()

    await cdp.send('Browser.setDownloadBehavior', {
      behavior: 'default',
    })

    const control = await browser.newPage()

    await control.goto(`chrome-extension://${extensionId}/test-control.html`)

    const galleryURL = `${origin}/portal/${settings.aula.myMediaRoute}`

    let page = await browser.newPage()

    await page.goto(galleryURL)

    /** Inject through the extension API so requests retain a real content-script sender. */
    const inject = () =>
      control.evaluate(
        async (url, filename, activationKey) => {
          const tabs = await chrome.tabs.query({})

          const tabId = tabs.find(tab => tab.url === url).id

          await chrome.storage.session.set({
            [`${activationKey}:${tabId}`]: true,
          })

          await chrome.scripting.executeScript({
            target: { tabId },
            files: [filename],
          })
        },
        galleryURL,
        settings.browser.contentScript,
        settings.archive.activationStorageKey,
      )

    /** Read the dates-only header and this session's active run for lifecycle assertions. */
    const state = () =>
      control.evaluate(
        async (key, runKey) => ({
          ...(await chrome.storage.local.get(key))[key],
          run: (await chrome.storage.session.get(runKey))[runKey],
        }),
        settings.archive.storageKey,
        settings.archive.runStorageKey,
      )

    /** Send a trusted click to the current panel and release its temporary browser element handle. */
    const click = async (field = 'toggle') => {
      const handle = await page.evaluateHandle(
        (id, field) =>
          document.getElementById(id).shadowRoot.getElementById(field),
        settings.browser.panelId,
        field,
      )

      await handle.asElement().click()

      await handle.dispose()
    }

    /** Include the displayed synthetic UI value when an expected state does not arrive. */
    const waitPanel = async (field, value) => {
      try {
        await page.waitForFunction(
          (id, field, value) =>
            document.getElementById(id)?.shadowRoot.getElementById(field)?.textContent === value,
          {},
          settings.browser.panelId,
          field,
          value,
        )
      }
      catch (error) {
        const actual = await page.evaluate(
          (id, field) =>
            document.getElementById(id)?.shadowRoot.getElementById(field)?.textContent,
          settings.browser.panelId,
          field,
        )

        throw new Error(`Expected ${field}: ${value}; displayed: ${actual}`, {
          cause: error,
        })
      }
    }

    /** Open a replacement gallery after the scenario closes its previous tab. */
    const openGallery = async () => {
      page = await browser.newPage()

      await page.goto(galleryURL)

      return page
    }

    return {
      browser,
      control,
      workerURL,
      worker,
      inject,
      state,
      click,
      waitPanel,
      openGallery,
      getPage: () => page,
    }
  }
  catch (error) {
    await browser?.close()

    throw error
  }
}
