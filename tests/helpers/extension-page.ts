import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { required } from '../../src/required'
import { until } from './panel'
import { createDom, trustedEvents } from './react-dom'

/** Run a packaged Material UI entrypoint in its own extension-like document, without global browser mocks. */
export const extensionPage = async (
  page: 'popup',
  chrome: object,
  options: {
    languages?: string[]
  } = {},
) => {
  const result = await build({
    entryPoints: [`src/ui/material/${page}.tsx`],
    bundle: true,
    loader: { '.svg': 'dataurl' },
    write: false,
    format: 'iife',
  })

  const dom = createDom(await readFile(`static/${page}.html`, 'utf8'), {
    url: `https://extension.invalid/${page}.html#synthetic`,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  })

  const { window } = dom

  const click = trustedEvents(window)

  let closed = false

  Object.assign(window, {
    chrome,
    close: () => {
      closed = true
    },
  })

  Object.defineProperty(window.navigator, 'languages', {
    value: options.languages ?? ['en-GB'],
  })

  Object.defineProperty(window.navigator, 'language', {
    value: options.languages?.[0] ?? 'en-GB',
  })

  window.eval(required(result.outputFiles[0]).text)

  await until(() => !!window.document.getElementById('clear-history'))

  const element = (id: string) => required(window.document.getElementById(id))

  return {
    dom,
    window,
    element,
    click: async (id: string) => click(element(id)),
    closed: () => closed,
  }
}
