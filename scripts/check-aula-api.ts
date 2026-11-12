import { execFileSync } from 'node:child_process'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'
import ts from 'typescript'
import { z } from 'zod'
import { CONFIG } from '../src/config'
import { readBytes } from '../src/streams'

/** Keep GitHub credentials in the CLI's environment, never in requests to Aula or shell command strings. */
const githubRequest = (args: string[], body?: object): unknown => JSON.parse(execFileSync('gh', [
  'api',
  ...args,
  ...(body ? ['--input', '-'] : []),
], {
  encoding: 'utf8',
  input: body ? JSON.stringify(body) : undefined,
  stdio: ['pipe', 'pipe', 'pipe'],
  timeout: CONFIG.timing.apiRequestMs,
}))

/**
 * Inspect public first-party assets without executing scripts or sending cookies.
 * Fail on missing or conflicting declarations instead of treating detection failure as compatibility.
 * Existing open or closed version issues suppress repeat notifications.
 */
export const checkAulaApi = async ({
  fetchPublic = fetch,
  github = githubRequest,
  repository = process.env.GITHUB_REPOSITORY ?? '',
  notifyUser = process.env.AULA_API_NOTIFY_USER ?? '',
  detectOnly = false,
} = {}): Promise<string> => {
  const { origin, apiVersion: supported } = CONFIG.aula

  const monitor = CONFIG.aulaMonitor

  /** Bound each public response and reject redirects, including redirects to login or another host. */
  const read = async (url: URL, limit: number): Promise<string> => {
    const response = await fetchPublic(url, {
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(CONFIG.timing.apiRequestMs),
    })

    if (!response.ok) {
      await response.body?.cancel()

      throw new Error(`Public Aula asset returned HTTP ${response.status}.`)
    }

    return new TextDecoder().decode(await readBytes(response, limit, 'api-contract', 'collection-limit'))
  }

  const portal = new URL(monitor.portalPath, origin)

  const dom = new JSDOM(await read(portal, CONFIG.limits.apiResponseBytes))

  const assets = new Set<string>()

  const versions = new Set<number>()

  /** Parse declarations without execution; comments and string examples cannot masquerade as the active version. */
  const inspect = (source: string): void => {
    if (!source.includes('aulaApiVersion')) {
      return
    }

    /** Visit actual assignments only, rejecting changed declaration formats rather than guessing. */
    const visit = (node: ts.Node): void => {
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
        && ts.isPropertyAccessExpression(node.left) && ts.isIdentifier(node.left.expression)
        && node.left.expression.text === 'window' && node.left.name.text === 'aulaApiVersion') {
        if (!ts.isStringLiteral(node.right) || !/^v[1-9]\d*$/.test(node.right.text)) {
          throw new Error('Aula API declaration has an unexpected format.')
        }

        versions.add(z.number().int().positive().safe().parse(Number(node.right.text.slice(1))))
      }

      ts.forEachChild(node, visit)
    }

    visit(ts.createSourceFile('aula-public.js', source, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS))
  }

  try {
    for (const script of dom.window.document.querySelectorAll('script')) {
      const src = script.getAttribute('src')

      if (src === null || src === '') {
        inspect(script.textContent)

        continue
      }

      const url = new URL(src, portal)

      if (url.origin === origin && !url.username && !url.password && url.pathname.startsWith(monitor.assetPathPrefix) && url.pathname.endsWith('.js')) {
        assets.add(url.href)
      }
    }
  }
  finally {
    dom.window.close()
  }

  if (assets.size > monitor.maxAssets) {
    throw new Error('Aula portal exceeds the public asset limit.')
  }

  for (const asset of assets) {
    inspect(await read(new URL(asset), monitor.assetBytes))
  }

  const [version] = versions

  if (versions.size !== 1 || version === undefined) {
    throw new Error('Cannot determine one unambiguous public Aula API version.')
  }

  if (detectOnly || version <= supported) {
    return `Aula frontend uses API v${version}; plugin supports v${supported}.`
  }

  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(notifyUser)) {
    throw new Error('Set GITHUB_REPOSITORY and AULA_API_NOTIFY_USER before sending an alert.')
  }

  const marker = `<!-- aula-api-version:v${version} -->`

  const pages = z.array(z.array(z.object({ body: z.string().nullable(), pull_request: z.unknown().optional() }))).parse(github([
    `repos/${repository}/issues?state=all&per_page=100`,
    '--paginate',
    '--slurp',
  ]))

  if (pages.flat().some(issue => issue.pull_request === undefined && issue.body?.includes(marker) === true)) {
    return `API v${version} already has an alert; no duplicate notification sent.`
  }

  const issue = z.object({ html_url: z.url() }).parse(github([`repos/${repository}/issues`, '--method', 'POST'], {
    title: `Aula API v${version} detected; plugin supports v${supported}`,
    body: `${marker}\n@${notifyUser} Aula's public frontend now declares API **v${version}**; this plugin implements **v${supported}**.\n\nReview the gallery contract before updating support. This does not prove that v${supported} is retired or that the newer API is compatible.\n\nSource: ${portal.href}\n\nDetected without login, cookies or private data.`,
  }))

  return `Opened API version alert: ${issue.html_url}`
}

const entry = process.argv[1]

if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  console.log(await checkAulaApi({ detectOnly: process.argv.includes('--detect-only') }))
}
