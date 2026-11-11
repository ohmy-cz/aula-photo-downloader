import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { test } from 'node:test'

void test('Privacy hook checks staged bytes and blocks unreviewed data, media and captures without rewriting the working copy', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aula-privacy-test-'))

  const env = { ...process.env, PRIVACY_CHECKER: resolve('scripts/check-privacy.mjs') }

  const git = (...args: string[]) => execFileSync('git', args, { cwd: directory, env, encoding: 'utf8', stdio: 'pipe' })

  const commit = () => spawnSync('git', ['commit', '-m', 'Synthetic hook fixture'], { cwd: directory, env, encoding: 'utf8' })

  /** Stage synthetic adversarial input while keeping the developer's visible file clean. */
  const stage = async (path: string, text: string | Buffer) => {
    await mkdir(dirname(join(directory, path)), { recursive: true })

    await writeFile(join(directory, path), text)

    git('add', '--', path)
  }

  try {
    git('init')

    git('config', 'user.name', 'Synthetic Privacy Fixture')

    git('config', 'user.email', 'fixture@example.invalid')

    git('config', 'commit.gpgsign', 'false')

    const hook = join(directory, '.git/hooks/pre-commit')

    await writeFile(hook, '#!/bin/sh\nnode "$PRIVACY_CHECKER" --staged\n')

    await chmod(hook, 0o755)

    const path = 'tests/helpers/synthetic.ts'

    const safe = 'export const child = { name: \'Synthetic Child\' }\n'

    await stage(path, 'export const child = { name: \'UNSAFE_FIXTURE_PERSON\' }\n')

    await writeFile(join(directory, path), safe)

    assert.notEqual(commit().status, 0)

    assert.equal(await readFile(join(directory, path), 'utf8'), safe)

    await stage(path, safe)

    assert.equal(commit().status, 0)

    for (const [path, content] of [
      ['tests/fixtures/unreviewed.json', '{"id": 9999999}'],
      ['tests/__snapshots__/synthetic.snap', 'Synthetic browser capture'],
      ['docs/unreviewed.png', Buffer.from([0x89, 0x50, 0x4E, 0x47, 0])],
      ['tests/helpers/synthetic.ts', `export const media = '${new URL('/unreviewed/file.jpg?Signature=not-a-real-secret', 'https://media-prod.aula.dk').href}'`],
    ] as const) {
      await stage(path, content)

      assert.notEqual(commit().status, 0, path)

      git('rm', '--cached', '--', path)
    }

    const image = 'tests/fixtures/sample.png'

    await mkdir(dirname(join(directory, image)), { recursive: true })

    await cp(image, join(directory, image))

    git('add', '--', image)

    assert.equal(commit().status, 0)

    const bytes = await readFile(image)

    await stage(image, Buffer.concat([bytes, Buffer.from([0])]))

    await writeFile(join(directory, image), bytes)

    assert.notEqual(commit().status, 0)

    assert.deepEqual(await readFile(join(directory, image)), bytes)
  }
  finally {
    await rm(directory, { recursive: true, force: true })
  }
})
