import { readFile } from 'node:fs/promises'
import http from 'node:http'
import { build } from 'esbuild'
import { bundleOptions, processingAssets } from './lib/build.mjs'

const settings = JSON.parse(await readFile('config.json', 'utf8'))

const albumsFixture = JSON.parse(
  await readFile('tests/fixtures/aula/albums-v25.json', 'utf8'),
)

const fakePage = `${settings.aula.origin}/portal/${settings.aula.myMediaRoute}`

const result = await build({
  ...bundleOptions(settings),
  entryPoints: ['src/ui/material/content.tsx'],
  write: false,
  format: 'iife',
  define: { 'location.href': JSON.stringify(fakePage) },
})

const content = result.outputFiles[0].contents

const items = [
  '20260430_095302.jpg',
  'A very long original filename demonstrating that the download panel stays still rather than hopping as each filename changes.png',
  '20260130_095302.mp4',
].map((name, i) => ({
  id: i + 1,
  mediaType: i === 2 ? 'video' : 'image',
  tags: [
    { name: 'Synthetic Child A', role: 'child' },
    { name: 'Synthetic Child B æøå', role: 'child' },
    { name: 'Synthetic Employee', role: 'employee' },
  ],
  file: {
    name,
    url: `${settings.aula.mediaOrigin}/synthetic/${i}.jpg?Signature=synthetic`,
    created: '2000-01-01T12:00:00Z',
  },
}))

const html = await readFile('scripts/demo/page.html', 'utf8')

const demoBundle = await build({
  ...bundleOptions(settings),
  entryPoints: ['scripts/demo/client.js'],
  write: false,
  format: 'iife',
})

const demoClient = demoBundle.outputFiles[0].contents

const pagesBundle = await build({
  ...bundleOptions(settings),
  entryPoints: ['scripts/demo/pages.js'],
  write: false,
  format: 'iife',
})

const previewPages = {}

previewPages['/popup-preview'] = (await readFile('static/popup.html', 'utf8'))
  .replace('{{script}}', settings.browser.popupScript)
  .replace(
    '<script type="module"',
    '<script src="/demo-pages.js"></script><script type="module"',
  )

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')

  try {
    if (previewPages[url.pathname]) {
      res.setHeader('Content-Type', 'text/html')

      res.end(previewPages[url.pathname])

      return
    }

    if (url.pathname === '/demo-pages.js') {
      res.setHeader('Content-Type', 'application/javascript')

      res.end(pagesBundle.outputFiles[0].contents)

      return
    }

    if (url.pathname === '/') {
      res.setHeader('Content-Type', 'text/html')

      res.end(html)

      return
    }

    if (url.pathname === '/demo-client.js') {
      res.setHeader('Content-Type', 'application/javascript')

      res.end(demoClient)

      return
    }

    if (url.pathname === '/content.js') {
      res.setHeader('Content-Type', 'application/javascript')

      res.end(content)

      return
    }

    if (url.pathname === '/demo-api') {
      const version
        = settings.aula.apiVersion
          + (url.searchParams.get('newerApi') === '1' ? 1 : 0)

      if (Number(url.searchParams.get('requestVersion')) !== version) {
        res.writeHead(410)

        res.end()

        return
      }

      if (url.searchParams.get('method') === settings.aula.albumsMethod) {
        res.setHeader('Content-Type', 'application/json')

        res.end(JSON.stringify({ ...albumsFixture, version }))

        return
      }

      const index = Number(url.searchParams.get('index'))

      const limit = Number(url.searchParams.get('limit'))

      res.setHeader('Content-Type', 'application/json')

      res.end(
        JSON.stringify({
          version,
          module: 'gallery',
          method: 'getMedia',
          status: { code: 0 },
          data: {
            album: null,
            startIndex: index,
            totalSize: 3,
            results: items.slice(index, index + limit),
          },
        }),
      )

      return
    }

    const path = url.pathname.startsWith('/fixtures/')
      ? `tests${url.pathname}`
      : `dist${url.pathname}`

    const allowed = new Set([
      '/fixtures/sample.jpg',
      '/fixtures/sample.png',
      '/fixtures/sample.mp4',
      `/${settings.browser.workerScript}`,
      `/${settings.browser.popupScript}`,
      `/${settings.browser.privacyPage}`,
      ...processingAssets(settings).map(asset => `/${asset}`),
    ])

    if (!allowed.has(url.pathname)) {
      res.writeHead(404)

      res.end()

      return
    }

    res.setHeader(
      'Content-Type',
      path.endsWith('.js')
        ? 'application/javascript'
        : path.endsWith('.html')
          ? 'text/html'
          : path.endsWith('.wasm')
            ? 'application/wasm'
            : 'application/octet-stream',
    )

    res.end(await readFile(path))
  }
  catch {
    res.writeHead(500)

    res.end('Demo error')
  }
})

server.listen(8765, '127.0.0.1', () =>
  console.log('Local alpha demo: http://127.0.0.1:8765/'))
