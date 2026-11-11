import { readFile } from 'node:fs/promises'

/** Parse Chrome's numeric version format; reject unsafe tag/path characters and out-of-range components. */
export const versionParts = (version) => {
  if (
    typeof version !== 'string'
    || !/^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,3}$/.test(version)
  ) {
    throw new Error(
      'Use a Chrome-compatible numeric package version with one to four components.',
    )
  }

  const parts = version.split('.').map(Number)

  if (parts.some(part => part > 65535) || parts.every(part => part === 0)) {
    throw new Error(
      'Version components must be 0–65535 and the version cannot be all zeroes.',
    )
  }

  return Array.from({ length: 4 }, (_, index) => parts[index] ?? 0)
}

/** Compare numeric Chrome versions, treating missing trailing components as zero. */
export const compareVersions = (left, right) => {
  const a = versionParts(left)

  const b = versionParts(right)

  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) {
      return a[index] - b[index]
    }
  }

  return 0
}

const pkg = JSON.parse(
  await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
)

const lock = JSON.parse(
  await readFile(new URL('../../package-lock.json', import.meta.url), 'utf8'),
)

export const packageVersion = pkg.version

versionParts(packageVersion)

if (
  lock.version !== packageVersion
  || lock.packages[''].version !== packageVersion
) {
  throw new Error(
    'Keep package.json and both root package-lock.json versions identical.',
  )
}
