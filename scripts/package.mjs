import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { zipSync } from 'fflate'

import { packageVersion as version } from './lib/version.mjs'

const settings = JSON.parse(await readFile('config.json', 'utf8'))

const files = {}

/** Recursively collect only the distributable build tree into relative ZIP entries. */
const collect = async (folder, prefix = '') => {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name)

    const name = prefix + entry.name

    if (entry.isDirectory()) {
      await collect(path, `${name}/`)
    }
    else {
      files[name] = [
        new Uint8Array(await readFile(path)),
        { mtime: new Date(1980, 0, 1) },
      ]
    }
  }
}

await collect('dist')

await mkdir('releases', { recursive: true })

const path = `releases/${settings.archive.rootFolder}-${version}.zip`

await writeFile(path, zipSync(files, { level: 9 }))

console.log(`Packaged ${path}`)
