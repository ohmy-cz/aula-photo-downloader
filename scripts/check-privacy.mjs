import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstatSync, readFileSync } from 'node:fs'
import process from 'node:process'
import ts from 'typescript'
import settings from '../config.json' with { type: 'json' }

// Only reviewed synthetic media, public regression fixtures and project icons belong here.
// Changing a digest requires inspecting the decoded content and metadata; never approve a live capture.
const approvedFixtures = new Map([
  [
    'static/icons/128.png',
    '5da576c5eee669c8db33425b97de72346142a33fa43c5f12210989e532b2133f',
  ],
  [
    'static/icons/16.png',
    '851f0cc3fe0dd48519cb2a271fba35d18db86c31ebf936ffc15aa9bcfad9d2b6',
  ],
  [
    'static/icons/32.png',
    'c0be2bcad31cd152edd6887a4f8d6dae58dd4df48685a7e06bb56f5e7eb76fd9',
  ],
  [
    'static/icons/48.png',
    '68452c9ec44672c7f8dcd112f3231b77de10d9c1dccc585f1cf1edc392351225',
  ],
  [
    'tests/fixtures/aula/albums-v25.json',
    'defc16f03b92a8bab4508780d4dd2c7c561c5e98f6eb101287888a70ef7a5d38',
  ],
  [
    'tests/fixtures/aula/gallery-v25.json',
    '1db56762c6a719129cee8eff70f796751465b6ca43f9631795876c30fd2fbcbb',
  ],
  [
    'tests/fixtures/metadata-only.heic',
    '4e1785e9924600d0274176f52609a2d514481877103b91c714bd2088ea803ae7',
  ],
  [
    'tests/fixtures/sample.heic',
    '1ba3aabf4e06ebe8fb40219895808a89603c5e9480cdd113e2624bb15bb0d020',
  ],
  [
    'tests/fixtures/sample.jpg',
    '51218654cd091169dd82f896919fb2aeb76f9292f234bbe28df3008c5b32c1ac',
  ],
  [
    'tests/fixtures/sample.mp4',
    '12ad88a6b58e364474f3338de07e530db7554339cd5e9326337440c81d22942d',
  ],
  [
    'tests/fixtures/sample.png',
    '6ce843ac878de25af850b471fc3bffec009c5a6ab2dd44303d6259eb433886f9',
  ],
])

const upstreamBinaries = new Set([
  'vendor/video/ffmpeg-core.wasm',
  'vendor/video/ffmpeg.tar.gz',
  'vendor/video/bindings.tar.gz',
])

const syntheticName = /^(?:Synthetic|Example|Test)(?:\b|[-_])|^[^\s/]+\.[a-z\d]{1,8}$/i

const nameField = /^(?:name|title|displayName|fullName|firstName|lastName|institutionName|albumName|creatorName|childName)$/i

const idField = /^(?:id|profileId|albumId|institutionProfileId)$/i

const capturePath = /(?:^|\/)(?:__snapshots__|snapshots|screenshots|captures|recordings)(?:\/|$)|\.(?:snap|har|log|zip)$/i

const outputPath = /(?:^|\/)(?:node_modules|dist|releases|coverage)(?:\/|$)/

const mediaUrl = /https?:\/\/[^\s"'<>`)]+/g

const email = /\b[\w.%+-]+@([A-Z\d.-]+\.[A-Z]{2,})\b/gi

const privatePath = /(?:\/Users\/|[A-Z]:\\Users\\)(?!synthetic\b|example\b|test\b)[^/\\\s]+/i

/** Flag identifiable fixture literals without logging their values; dynamic production DTO fields are unaffected. */
const inspectLiterals = (path, text, fail) => {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)

  /** Inspect only literal identity fields and child-tag arrays, retaining wire-format numeric types. */
  const visit = (node) => {
    if (ts.isPropertyAssignment(node)) {
      const key = node.name.getText(source).replace(/['"]/g, '')

      const value = node.initializer

      if (nameField.test(key) && ts.isStringLiteral(value) && value.text && !syntheticName.test(value.text) && value.text !== 'prefers-reduced-motion') {
        fail('Use explicitly synthetic names and labels in test data')
      }

      if (idField.test(key) && ts.isNumericLiteral(value) && Number(value.text) > 1999) {
        fail('Use reserved synthetic fixture IDs (1–1999)')
      }

      if (key === 'children' && ts.isArrayLiteralExpression(value) && value.elements.some(item => ts.isStringLiteral(item) && !syntheticName.test(item.text))) {
        fail('Use explicitly synthetic child tags')
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(source)
}

/** Audit the exact index for hooks, or current non-ignored files for development/CI; never rewrite files or expose values. */
const checkPrivacy = () => {
  const staged = process.argv.includes('--staged')

  const args = staged ? ['ls-files', '-z'] : ['ls-files', '-z', '--cached', '--others', '--exclude-standard']

  const paths = new Set(execFileSync('git', args, { encoding: 'utf8' }).split('\0').filter(Boolean))

  const symlinks = new Set(execFileSync('git', ['ls-files', '--stage', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(entry => entry.startsWith('120000 '))
    .map(entry => entry.slice(entry.indexOf('\t') + 1)))

  const failures = new Set()

  for (const path of paths) {
    const stat = staged ? undefined : lstatSync(path, { throwIfNoEntry: false })

    if (!staged && stat === undefined) {
      continue
    }

    const fail = reason => failures.add(`${path}: ${reason}`)

    if (outputPath.test(path)) {
      fail('Generated files, dependencies and local archives must not be committed')

      continue
    }

    if ((staged && symlinks.has(path)) || stat?.isSymbolicLink()) {
      fail('Symlinks cannot establish fixture provenance')

      continue
    }

    // Exact upstream source archives/WASM are not test media; their provenance is documented in vendor/video.
    if (upstreamBinaries.has(path)) {
      continue
    }

    const bytes = staged
      ? execFileSync('git', ['show', `:${path}`], { maxBuffer: 64 * 1024 * 1024 })
      : readFileSync(path)

    const approved = approvedFixtures.get(path)

    if (approved !== undefined) {
      if (createHash('sha256').update(bytes).digest('hex') !== approved) {
        fail('Fixture changed: review its synthetic/public provenance before approving it')
      }

      continue
    }

    if (capturePath.test(path) || (path.startsWith('tests/fixtures/') && !/\.(?:[cm]?js|tsx?|md)$/.test(path))) {
      fail('Unreviewed fixture or capture; use synthetic data and record its reviewed digest')

      continue
    }

    let text

    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)

      if (bytes.includes(0)) {
        throw new Error('Binary')
      }
    }
    catch {
      fail('Unreviewed binary/media file; do not commit Aula downloads or screenshots')

      continue
    }

    if ([...text.matchAll(mediaUrl)].some(([value]) => {
      if (!value.startsWith(`${settings.aula.mediaOrigin}/`)) {
        return false
      }

      const url = new URL(value.replace(/&amp;/g, '&'))

      return !url.pathname.startsWith('/synthetic/')
        || [...url.searchParams].some(([key, value]) => /signature|token|key-pair-id/i.test(key) && !/^(?:synthetic|fixture|example)$/i.test(value))
    })) {
      fail('Live Aula media URL: use the reserved /synthetic/ fixture path')
    }

    if ([...text.matchAll(/\/galleri\/(\d+)/g)].some(([, id]) => Number(id) > 1999 && id !== '12345')) {
      fail('Use a reserved synthetic album-route ID')
    }

    if (privatePath.test(text) || /data:(?:image|video|audio)\/[\w.+-]+;base64,/i.test(text)) {
      fail('Private filesystem path or embedded media capture')
    }

    if (/^(?:tests\/|scripts\/(?:demo(?:\/|\.mjs)|browser\/|verify-wasm\.mjs|test-browser\.mjs))/.test(path)) {
      if ([...text.matchAll(email)].some(([, domain]) => !/(?:^|\.)(?:example\.(?:com|org|net)|invalid|test)$/i.test(domain))) {
        fail('Use reserved example/invalid/test email domains')
      }

      if (/\b\d{6}[- ]\d{4}\b|\+45[ -]*(?:\d[ -]*){8}\b/.test(text)) {
        fail('Do not retain personal identification or telephone numbers in test data')
      }

      inspectLiterals(path, text, fail)
    }
  }

  if (failures.size > 0) {
    throw new Error(`Privacy check failed:\n${[...failures].join('\n')}\nSanitize and re-stage the affected files. Do not bypass this check.`)
  }

  console.log(`Privacy check passed (${staged ? 'staged index' : 'working tree'}).`)
}

try {
  checkPrivacy()
}
catch (error) {
  console.error(error.message)

  process.exitCode = 1
}
