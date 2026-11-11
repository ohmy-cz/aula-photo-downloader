import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { build } from 'esbuild'
import { marked } from 'marked'
import { copyDependencyLicenses } from './licenses.mjs'
import { packageVersion } from './version.mjs'
import { capPhotoMemory } from './wasm.mjs'

/** Bundle supplied settings in every entrypoint, including synthetic test origins. */
export const bundleOptions = settings => ({
  bundle: true,
  loader: { '.svg': 'dataurl' },
  target: `chrome${settings.browser.minimumChromeVersion}`,
  platform: 'browser',
  legalComments: 'eof',
  minify: true,
  metafile: true,
  logLevel: 'warning',
  plugins: [
    {
      name: 'settings',
      setup: (builder) => {
        builder.onLoad({ filter: /[\\/]config\.json$/ }, () => ({
          contents: JSON.stringify(settings),
          loader: 'json',
        }))
      },
    },
  ],
})

/** Exact packaged processing paths, also used by the development server's allowlist. */
export const processingAssets = settings => [
  settings.browser.wasmAsset,
  settings.browser.ffmpegCoreAsset,
  settings.browser.ffmpegWasmAsset,
]

/** Generate permissions and CSP from the same settings compiled into runtime validation. */
export const extensionManifest = (source, settings) => ({
  ...source,
  version: packageVersion,
  minimum_chrome_version: String(settings.browser.minimumChromeVersion),
  host_permissions: [`${settings.aula.mediaOrigin}/*`],
  optional_host_permissions: settings.immich.hostPatterns,
  action: { ...source.action, default_popup: settings.browser.popupPage },
  options_ui: { page: settings.browser.optionsPage, open_in_tab: true },
  content_security_policy: {
    extension_pages: `script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; connect-src 'self' ${settings.aula.mediaOrigin} ${[...new Set(settings.immich.hostPatterns.map(pattern => new URL(pattern).protocol))].join(' ')}; worker-src 'self';`,
  },
})

/** Build into a caller-owned directory; include WASM assets and preserve bundled license texts. */
export const buildExtension = async (settings, directory, documents = true) => {
  await mkdir(directory, { recursive: true })

  await cp('static', directory, { recursive: true })

  const source = JSON.parse(await readFile('static/manifest.json', 'utf8'))

  await writeFile(
    join(directory, 'manifest.json'),
    `${JSON.stringify(extensionManifest(source, settings), null, 2)}\n`,
  )

  for (const [page, script] of [
    [settings.browser.popupPage, settings.browser.popupScript],
    [settings.browser.optionsPage, settings.browser.optionsScript],
  ]) {
    const markup = await readFile(join('static', page), 'utf8')

    await writeFile(
      join(directory, page),
      markup.replace('{{script}}', script),
    )
  }

  const vendor = 'node_modules/@colorhythm/exiftool-wasm/dist/esm'

  const wasm = (await readdir(vendor)).find(name => name.endsWith('.wasm'))

  if (!wasm) {
    throw new Error('Pinned WASM asset missing')
  }

  const sources = [
    `${vendor}/${wasm}`,
    'vendor/video/ffmpeg-core.js',
    'vendor/video/ffmpeg-core.wasm',
  ]

  for (const [index, asset] of processingAssets(settings).entries()) {
    const path = join(directory, asset)

    await mkdir(dirname(path), { recursive: true })

    if (index === 0) {
      await writeFile(path, capPhotoMemory(await readFile(sources[index]), settings.limits.photoWasmMemoryBytes))
    }
    else {
      await cp(sources[index], path)
    }
  }

  const options = bundleOptions(settings)

  const modules = await build({
    ...options,
    entryPoints: [
      { in: 'src/background.ts', out: 'background' },
      {
        in: 'src/ui/material/popup.tsx',
        out: settings.browser.popupScript.replace(/\.js$/, ''),
      },
      {
        in: 'src/ui/material/options.tsx',
        out: settings.browser.optionsScript.replace(/\.js$/, ''),
      },
      { in: 'src/runtime/offscreen.ts', out: 'runtime/offscreen' },
      {
        in: 'src/runtime/worker.ts',
        out: settings.browser.workerScript.replace(/\.js$/, ''),
      },
    ],
    outdir: directory,
    outbase: 'src',
    format: 'esm',
    external: ['node:fs', 'fs'],
  })

  const content = await build({
    ...options,
    entryPoints: ['src/ui/material/content.tsx'],
    outfile: join(directory, settings.browser.contentScript),
    format: 'iife',
  })

  await copyDependencyLicenses([modules, content], directory)

  const policy = await readFile('PRIVACY.md', 'utf8')

  await writeFile(
    join(directory, settings.browser.privacyPage),
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Privacy — Aula Photo Downloader</title><style>body{font:16px/1.6 system-ui;max-width:720px;margin:32px auto;padding:0 20px;color:#163f58}</style><main>${marked.parse(policy)}</main></html>`,
  )

  await cp('vendor/video', join(directory, 'sources', 'video'), {
    recursive: true,
    filter: path => !/ffmpeg-core\.(?:js|wasm)$/.test(path),
  })

  if (documents) {
    await cp('docs', join(directory, 'docs'), { recursive: true })

    for (const name of [
      'README.md',
      'PRIVACY.md',
      'THIRD_PARTY_NOTICES.md',
      'SECURITY.md',
      'LICENSE',
    ]) {
      await cp(name, join(directory, name))
    }
  }
}
