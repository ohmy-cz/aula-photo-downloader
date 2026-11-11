import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import https from 'node:https'
import { join } from 'node:path'

/** Close sockets and listening handles owned by the synthetic test environment. */
const closeServer = async (server) => {
  server?.closeAllConnections()

  if (server?.listening) {
    await new Promise(resolve => server.close(resolve))
  }
}

/** Serve synthetic API/media on isolated HTTPS origins; temporary keys and both servers belong to the caller. */
export const startFixtureServers = async (directory, settings) => {
  const fixtures = [
    await readFile('tests/fixtures/sample.jpg'),
    await readFile('tests/fixtures/sample.mp4'),
  ]

  const state = {
    apiVersion: settings.aula.apiVersion,
    holdMedia: false,
    collectionFinished: false,
    unavailableOriginal: false,
    emptyGallery: false,
    collectionFailure: false,
    holdCollection: false,
    heldResponse: null,
    heldGalleryResponse: null,
  }

  let server, mediaServer

  /** Destroy deliberately held responses before closing both servers, including partially started environments. */
  const close = async () => {
    state.heldResponse?.destroy()

    state.heldGalleryResponse?.destroy()

    await closeServer(server)

    await closeServer(mediaServer)
  }

  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        join(directory, 'key.pem'),
        '-out',
        join(directory, 'cert.pem'),
        '-days',
        '1',
        '-subj',
        '/CN=127.0.0.1',
      ],
      { stdio: 'ignore' },
    )

    server = https.createServer(
      {
        key: await readFile(join(directory, 'key.pem')),
        cert: await readFile(join(directory, 'cert.pem')),
      },
      (request, response) => {
        const url = new URL(request.url, settings.aula.origin)

        if (url.pathname.startsWith('/api/')) {
          if (Number(url.pathname.match(/\d+/)[0]) !== state.apiVersion) {
            response.writeHead(410)

            response.end()

            return
          }

          const index = Number(url.searchParams.get('index'))

          if (index > 0 && state.collectionFailure) {
            response.writeHead(503)

            response.end('Synthetic API failure')

            return
          }

          if (index > 0 && state.holdCollection) {
            state.heldGalleryResponse = response

            return
          }

          state.collectionFinished = index > 0 || state.emptyGallery

          response.setHeader('Content-Type', 'application/json')

          response.end(
            JSON.stringify({
              version: state.apiVersion,
              module: 'gallery',
              method: 'getMedia',
              status: { code: 0 },
              data: {
                startIndex: index,
                album: { name: 'Synthetic' },
                results:
                  index || state.emptyGallery
                    ? []
                    : ['jpg', 'mp4'].map((extension, index) => ({
                        id: index + 1,
                        mediaType: index ? 'video' : 'image',
                        tags: [{ name: 'Synthetic Child', role: 'child' }],
                        file: {
                          name: `camera-${index + 1}.${extension}`,
                          created: new Date().toISOString(),
                          url:
                            state.unavailableOriginal && index === 0
                              ? null
                              : `${settings.aula.mediaOrigin}/media/${index + 1}.${extension}`,
                        },
                      })),
              },
            }),
          )
        }
        else if (url.pathname.startsWith('/media/')) {
          assert(
            state.collectionFinished,
            'Original fetching must wait for complete collection',
          )

          const index = url.pathname.endsWith('mp4') ? 1 : 0

          response.setHeader(
            'Content-Type',
            index ? 'video/mp4' : 'image/jpeg',
          )

          if (state.holdMedia) {
            state.heldResponse = response
          }
          else {
            response.end(fixtures[index])
          }
        }
        else {
          response.setHeader('Content-Type', 'text/html')

          response.end('<!doctype html><title>Synthetic Aula gallery</title>')
        }
      },
    )

    server.listen(0, '127.0.0.1')

    await once(server, 'listening')

    const origin = `https://127.0.0.1:${server.address().port}`

    settings.aula.origin = origin

    mediaServer = https.createServer(
      {
        key: await readFile(join(directory, 'key.pem')),
        cert: await readFile(join(directory, 'cert.pem')),
      },
      server.listeners('request')[0],
    )

    mediaServer.listen(0, '127.0.0.1')

    await once(mediaServer, 'listening')

    settings.aula.mediaOrigin = `https://127.0.0.1:${mediaServer.address().port}`

    return { state, close }
  }
  catch (error) {
    await close()

    throw error
  }
}
