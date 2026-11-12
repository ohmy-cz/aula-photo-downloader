import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkAulaApi } from '../scripts/check-aula-api'
import { CONFIG } from '../src/config'

/** Exercise the full monitor against invented public pages and a GitHub issue store; no live data or notifications. */
const scenario = () => {
  const portal = CONFIG.aulaMonitor.portalPath

  const main = `${CONFIG.aulaMonitor.assetPathPrefix}main.synthetic.js`

  const vendor = `${CONFIG.aulaMonitor.assetPathPrefix}vendor.synthetic.js`

  const sources = new Map<string, string | Response | Error>([
    [portal, `<script src="https://example.invalid/untrusted.js"></script><script src="/auth/login.php"></script><script src="${vendor}"></script><script src="${main}"></script><script src="${main}"></script>`],
    [vendor, '/* Synthetic dependency without an API version. */'],
    [main, `window.aulaApiVersion="v${CONFIG.aula.apiVersion}";`],
  ])

  const issues: { title: string, body: string, state: string }[] = []

  const requests: string[] = []

  const fetchPublic: typeof fetch = async (input, init) => {
    const url = new URL(String(input))

    assert.equal(url.origin, CONFIG.aula.origin)

    assert.equal(init?.credentials, 'omit')

    assert.equal(init?.redirect, 'error')

    assert(init?.signal)

    assert.equal(new Headers(init.headers).has('authorization'), false)

    requests.push(url.pathname)

    const source = sources.get(url.pathname)

    assert.notEqual(source, undefined, 'Only approved first-party scripts and the portal may be requested')

    if (source instanceof Error) {
      throw source
    }

    return source instanceof Response ? source : new Response(source)
  }

  const github = (args: string[], body?: object): unknown => {
    if (body) {
      assert.deepEqual(args, ['repos/example/plugin/issues', '--method', 'POST'])

      issues.push({ ...body as { title: string, body: string }, state: 'open' })

      return { html_url: 'https://github.com/example/plugin/issues/1' }
    }

    assert.deepEqual(args, ['repos/example/plugin/issues?state=all&per_page=100', '--paginate', '--slurp'])

    return [issues]
  }

  return {
    sources,
    main,
    vendor,
    portal,
    issues,
    requests,
    run: async (detectOnly = false) => checkAulaApi({ fetchPublic, github, repository: 'example/plugin', notifyUser: 'example-maintainer', detectOnly }),
  }
}

void test('Public Aula monitoring stays silent when supported, then mentions once per newer version including closed alerts', async () => {
  const monitor = scenario()

  await monitor.run()

  assert.equal(monitor.issues.length, 0)

  assert.deepEqual(monitor.requests, [monitor.portal, monitor.vendor, monitor.main])

  const version = CONFIG.aula.apiVersion + 1

  monitor.sources.set(monitor.main, `globalThis.syntheticMonitorExecuted = true; window.aulaApiVersion = 'v${version}';`)

  await monitor.run(true)

  assert.equal(monitor.issues.length, 0)

  await monitor.run()

  assert.equal(monitor.issues.length, 1)

  const [issue] = monitor.issues

  assert(issue)

  assert.equal(issue.title, `Aula API v${version} detected; plugin supports v${CONFIG.aula.apiVersion}`)

  assert.match(issue.body, /@example-maintainer/)

  assert.equal(Reflect.has(globalThis, 'syntheticMonitorExecuted'), false)

  issue.state = 'closed'

  await monitor.run()

  assert.equal(monitor.issues.length, 1)

  monitor.sources.set(monitor.main, `window.aulaApiVersion="v${version + 1}";`)

  await monitor.run()

  assert.equal(monitor.issues.length, 2)
})

void test('Missing, conflicting, oversized and unavailable public version signals fail without creating an issue', async () => {
  for (const source of [
    'const syntheticExample = "window.aulaApiVersion=\'v25\'"; /* window.aulaApiVersion="v25" */',
    'window.aulaApiVersion="v26"; window.aulaApiVersion="v27";',
    'window.aulaApiVersion="v99999999999999999999999999";',
    new Response('Synthetic upstream outage', { status: 503 }),
    new Response('Synthetic oversized response', { headers: { 'content-length': String(CONFIG.aulaMonitor.assetBytes + 1) } }),
    new Error('Synthetic blocked redirect'),
  ]) {
    const monitor = scenario()

    monitor.sources.set(monitor.main, source)

    await assert.rejects(monitor.run())

    assert.equal(monitor.issues.length, 0)
  }
})
