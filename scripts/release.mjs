import { execFileSync } from 'node:child_process'
import { copyFile, readFile } from 'node:fs/promises'
import process from 'node:process'
import { unzipSync } from 'fflate'
import { compareVersions, packageVersion } from './lib/version.mjs'

const repository = process.env.GITHUB_REPOSITORY

const sha = process.env.GITHUB_SHA

if (
  !repository
  || !/^[\w.-]+\/[\w.-]+$/.test(repository)
  || !sha
  || !/^[a-f0-9]{40}$/.test(sha)
) {
  throw new Error(
    'Release publication requires an exact GitHub repository and checked commit.',
  )
}

const settings = JSON.parse(await readFile('config.json', 'utf8'))

const assetName = 'aula-photo-downloader.zip'

const archive = `releases/${settings.archive.rootFolder}-${packageVersion}.zip`

const entries = unzipSync(await readFile(archive))

const manifest = JSON.parse(new TextDecoder().decode(entries['manifest.json']))

if (
  manifest.version !== packageVersion
  || !entries.LICENSE
  || !entries['THIRD_PARTY_NOTICES.md']
  || !Object.keys(entries).some(name => name.startsWith('sources/video/'))
) {
  throw new Error(
    'Release ZIP must contain the matching manifest, licenses and corresponding video sources.',
  )
}

/** Invoke the installed GitHub CLI with argument arrays, never shell interpolation. */
const gh = (...args) =>
  execFileSync('gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

/** Only a real HTTP 404 means missing; permission, network and rate-limit failures stop publication. */
const get = (path) => {
  try {
    return JSON.parse(gh('api', `repos/${repository}/${path}`))
  }
  catch (error) {
    if (/HTTP 404/.test(String(error.stderr))) {
      return null
    }

    throw error
  }
}

const tag = `v${packageVersion}`

/** Include unpublished drafts, which GitHub's release-by-tag endpoint does not return. */
const findRelease = () =>
  JSON.parse(gh('api', `repos/${repository}/releases?per_page=100`, '--paginate', '--slurp'))
    .flat()
    .find(release => release.tag_name === tag) ?? null

const existingTag = get(`git/ref/tags/${tag}`)

const existingCommit = existingTag ? get(`commits/${tag}`) : null

if (existingCommit && existingCommit.sha !== sha) {
  throw new Error(
    `${tag} already belongs to another commit. Increase the package version.`,
  )
}

let release = findRelease()

if (!existingCommit) {
  if (release && !release.draft) {
    throw new Error(
      'Published release has no verifiable tag; do not change it.',
    )
  }

  if (release && release.target_commitish !== sha) {
    throw new Error('Existing draft targets another commit.')
  }

  gh(
    'api',
    `repos/${repository}/git/refs`,
    '--method',
    'POST',
    '--raw-field',
    `ref=refs/tags/${tag}`,
    '--raw-field',
    `sha=${sha}`,
  )
}

if (release && !release.draft) {
  if (
    !existingCommit
    || !release.assets.some(asset => asset.name === assetName)
  ) {
    throw new Error(
      'Published release is incomplete or its tag cannot be verified; do not overwrite it.',
    )
  }

  console.log(`${tag} is already published for this commit.`)
}
else {
  if (!release) {
    gh(
      'release',
      'create',
      tag,
      '--repo',
      repository,
      '--target',
      sha,
      '--draft',
      '--title',
      `Aula Photo Downloader ${packageVersion} (alpha)`,
      '--notes',
      'Independent alpha; not affiliated with Aula or KOMBIT. Use at your own risk. Photo tagging stays on your device. Extract the ZIP and load its folder in Chrome using Developer mode.',
    )

    release = findRelease()
  }

  const target = get(`commits/${tag}`)

  if (!target || target.sha !== sha || !release?.draft) {
    throw new Error('Draft tag does not identify the checked commit.')
  }

  await copyFile(archive, `releases/${assetName}`)

  gh(
    'release',
    'upload',
    tag,
    `releases/${assetName}`,
    '--repo',
    repository,
    '--clobber',
  )

  const latest = get('releases/latest')

  const promote
    = !latest
      || compareVersions(packageVersion, latest.tag_name.replace(/^v/, '')) > 0

  gh(
    'release',
    'edit',
    tag,
    '--repo',
    repository,
    '--draft=false',
    '--prerelease=false',
    `--latest=${promote}`,
  )

  console.log(
    `Published ${tag}${promote ? ' as latest' : ' without replacing a newer release'}.`,
  )
}
