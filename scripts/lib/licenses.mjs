import { cp, mkdir, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Bundle each dependency's actual copyright notice, including nested versions used by the built entrypoints. */
export const copyDependencyLicenses = async (builds, directory) => {
  const packages = new Set(
    builds
      .flatMap(result => Object.keys(result.metafile.inputs))
      .map(path => path.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//)?.[1])
      .filter(Boolean),
  )

  const aliases = {
    'zod': 'ZOD-MIT.txt',
    'i18next': 'i18next-MIT.txt',
    'i18next-browser-languagedetector':
      'i18next-browser-languagedetector-MIT.txt',
    '@js-temporal/polyfill': 'Temporal-ISC.txt',
    'jsbi': 'JSBI-Apache-2.0.txt',
  }

  await mkdir(join(directory, 'licenses'), { recursive: true })

  for (const path of packages) {
    const pkg = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'))

    const files = (await readdir(path)).filter(file =>
      /^(?:license|copying)(?:\.|$)/i.test(file),
    )

    if (!files.length) {
      throw new Error(`Missing dependency license: ${pkg.name}`)
    }

    for (const file of files) {
      const name
        = aliases[pkg.name]
          ?? `${pkg.name.replace(/[@/]/g, '_')}-${pkg.version}-${file}.txt`

      await cp(join(path, file), join(directory, 'licenses', name))
    }
  }
}
