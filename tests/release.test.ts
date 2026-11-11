import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import process from 'node:process'
import { test } from 'node:test'
import { strToU8, zipSync } from 'fflate'

/** Run release CLIs in a private repository fixture; no real GitHub command or download is used. */
const fixture = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aula-release-test-'))

  for (const folder of ['scripts/lib', 'releases', 'bin']) {
    await mkdir(join(directory, folder), { recursive: true })
  }

  for (const file of [
    'package.json',
    'package-lock.json',
    'config.json',
    'scripts/lib/version.mjs',
    'scripts/check-version.mjs',
    'scripts/release.mjs',
  ]) {
    await cp(file, join(directory, file))
  }

  if (process.platform !== 'win32') {
    await symlink(
      join(process.cwd(), 'node_modules'),
      join(directory, 'node_modules'),
    )
  }

  const pkg = JSON.parse(await readFile('package.json', 'utf8')) as {
    version: string
  }

  return { directory, version: pkg.version }
}

void test('PR version gate runs against a real Git base and rejects unchanged or invalid package versions', async () => {
  const { directory } = await fixture()

  try {
    const packagePath = join(directory, 'package.json')

    const current = await readFile(packagePath, 'utf8')

    const pkg = JSON.parse(current) as { version: string }

    pkg.version = '0.0.0.1'

    await writeFile(packagePath, JSON.stringify(pkg))

    const git = (...args: string[]) =>
      execFileSync('git', args, {
        cwd: directory,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })

    git('init')

    git('add', 'package.json')

    git(
      '-c',
      'user.name=Release fixture',
      '-c',
      'user.email=fixture@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      'Synthetic base',
    )

    const sha = git('rev-parse', 'HEAD').trim()

    const eventPath = join(directory, 'event.json')

    await writeFile(
      eventPath,
      JSON.stringify({ pull_request: { base: { sha } } }),
    )

    await writeFile(packagePath, current)

    const run = () =>
      spawnSync(process.execPath, ['scripts/check-version.mjs'], {
        cwd: directory,
        encoding: 'utf8',
        env: { ...process.env, GITHUB_EVENT_PATH: eventPath },
      })

    assert.equal(run().status, 0)

    // Point the PR base at the current package version to model a forgotten bump.
    git('add', 'package.json')

    git(
      '-c',
      'user.name=Release fixture',
      '-c',
      'user.email=fixture@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      'Current release',
    )

    await writeFile(
      eventPath,
      JSON.stringify({
        pull_request: { base: { sha: git('rev-parse', 'HEAD').trim() } },
      }),
    )

    assert.match(run().stderr, /Increase package.json/)

    for (const invalid of ['1.2.3.4.5', '1.65536', '0.0.0.0', '01.2']) {
      pkg.version = invalid

      await writeFile(packagePath, JSON.stringify(pkg))

      assert.notEqual(run().status, 0)
    }
  }
  finally {
    await rm(directory, { recursive: true, force: true })
  }
})

void test(
  'Release CLI publishes drafts, resumes failed uploads, preserves published assets and refuses conflicting tags',
  { skip: process.platform === 'win32' },
  async () => {
    const { directory, version } = await fixture()

    try {
      const settings = JSON.parse(await readFile('config.json', 'utf8')) as {
        archive: { rootFolder: string }
      }

      await writeFile(
        join(
          directory,
          `releases/${settings.archive.rootFolder}-${version}.zip`,
        ),
        zipSync({
          'manifest.json': strToU8(JSON.stringify({ version })),
          'LICENSE': strToU8('Synthetic license'),
          'THIRD_PARTY_NOTICES.md': strToU8('Synthetic notices'),
          'sources/video/source.txt': strToU8('Synthetic corresponding source'),
        }),
      )

      const statePath = join(directory, 'github.json')

      const sha = 'a'.repeat(40)

      // Publication runs on Linux. A POSIX executable simulates GitHub while the real CLI orchestrator runs unchanged.
      await writeFile(
        join(directory, 'bin/gh'),
        `#!/usr/bin/env node
import fs from "node:fs";
const path = process.env.FAKE_GITHUB_STATE;
const state = JSON.parse(fs.readFileSync(path, "utf8"));
const args = process.argv.slice(2);
state.calls.push(args);
const save = () => fs.writeFileSync(path, JSON.stringify(state));
const fail = (message) => {save(); process.stderr.write(message); process.exit(1);};
let reply = {};
if (args[0] === "api") {
  if (state.forbidden) fail("HTTP 403");
  const route = args[1].split("/").slice(3).join("/");
  if (route.startsWith("git/ref/")) {
    if (!state.sha) fail("HTTP 404");
    reply = {object: {sha: state.sha}};
  } else if (route === "git/refs") {
    state.sha = args.find(value => value.startsWith("sha=")).slice(4);
  } else if (route.startsWith("commits/")) {
    if (!state.sha) fail("HTTP 422");
    reply = {sha: state.sha};
  } else if (route === "releases?per_page=100") {
    reply = [state.release ? [state.release] : []];
  } else if (route === "releases" && args.includes("POST")) {
    state.release = {tag_name: args.find(value => value.startsWith("tag_name=")).slice(9), draft: true, target_commitish: process.env.GITHUB_SHA, assets: []};
    reply = state.release;
  } else if (route === "releases/latest") {
    if (!state.latest) fail("HTTP 404");
    reply = state.latest;
  } else fail("Unknown route");
} else if (args[1] === "upload") {
  if (state.failUpload) fail("Synthetic upload interruption");
  state.release.assets = [{name: "aula-photo-downloader.zip"}];
} else if (args[1] === "edit") {
  state.release.draft = false;
  if (args.includes("--latest=true")) state.latest = {tag_name: args[2]};
} else fail("Unknown command");
save();
process.stdout.write(JSON.stringify(reply));
`,
        { mode: 0o755 },
      )

      const run = () =>
        spawnSync(process.execPath, ['scripts/release.mjs'], {
          cwd: directory,
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: join(directory, 'bin') + delimiter + (process.env.PATH ?? ''),
            GITHUB_SHA: sha,
            GITHUB_REPOSITORY: 'fixture/plugin',
            FAKE_GITHUB_STATE: statePath,
          },
        })

      const write = async (state: object) =>
        writeFile(statePath, JSON.stringify({ calls: [], ...state }))

      const read = async () =>
        JSON.parse(await readFile(statePath, 'utf8')) as {
          sha?: string
          release?: { draft: boolean, assets: { name: string }[] }
          calls: string[][]
          latest?: { tag_name: string }
        }

      await write({ failUpload: true })

      assert.match(run().stderr, /Synthetic upload interruption/)

      const draft = await read()

      assert.equal(draft.release?.draft, true)

      await write({ ...draft, failUpload: false })

      const resumed = run()

      assert.equal(resumed.status, 0, resumed.stderr)

      const published = await read()

      assert.equal(published.release?.draft, false)

      assert.equal(published.latest?.tag_name, `v${version}`)

      assert.equal(run().status, 0)

      assert.deepEqual((await read()).release, published.release)

      assert.equal(
        (await read()).calls.filter(call => call[1] === 'upload').length,
        2,
      )

      await write({ sha: 'b'.repeat(40) })

      assert.match(run().stderr, /already belongs to another commit/)

      assert(!(await read()).calls.some(call => call[0] === 'release'))

      await write({ latest: { tag_name: 'v65535' } })

      assert.equal(run().status, 0)

      assert(
        (await read()).calls.some(call => call.includes('--latest=false')),
      )

      await write({ forbidden: true })

      assert.notEqual(run().status, 0)

      assert.equal((await read()).sha, undefined)
    }
    finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
)
