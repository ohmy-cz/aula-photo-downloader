import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { compareVersions, packageVersion } from './lib/version.mjs'

const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'))

const base = event.pull_request?.base.sha

if (base) {
  if (!/^[a-f0-9]{40}$/.test(base)) {
    throw new Error('Invalid PR base commit.')
  }

  const previous = JSON.parse(
    execFileSync('git', ['show', `${base}:package.json`], { encoding: 'utf8' }),
  ).version

  if (compareVersions(packageVersion, previous) <= 0) {
    throw new Error(
      `Increase package.json's version above ${previous} before merging, and update package-lock.json.`,
    )
  }
}

console.log(`Validated package version ${packageVersion}.`)
