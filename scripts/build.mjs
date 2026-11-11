import { readFile, rm } from 'node:fs/promises'
import { buildExtension } from './lib/build.mjs'

const settings = JSON.parse(await readFile('config.json', 'utf8'))

await rm('dist', { recursive: true, force: true })

await buildExtension(settings, 'dist')

console.log('Built local-only Chrome extension in dist/.')
