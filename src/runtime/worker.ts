import type { Job, WorkerResult } from '../types'
import { dispose } from '@colorhythm/exiftool-wasm'
import { CONFIG } from '../config'
import { processBytes } from '../metadata/processor'
import { processVideo } from '../metadata/video'

/** Map WASM loading to the extension-packaged asset so processing never executes remote code. */
const localFetch: typeof fetch = async () =>
  fetch(new URL(CONFIG.browser.wasmAsset, new URL('../', import.meta.url)))

globalThis.onmessage = async (event: MessageEvent<Job & { bytes: ArrayBuffer }>) => {
  const { id, media, bytes } = event.data

  try {
    const output
      = media.kind === 'video'
        ? await processVideo(media, new Uint8Array(bytes))
        : await processBytes(media, new Uint8Array(bytes), localFetch)

    globalThis.postMessage({ id, ...output } satisfies WorkerResult, {
      transfer: [output.bytes],
    })
  }
  catch {
    globalThis.postMessage({
      id,
      error: 'Browser metadata processing or verification failed.',
    } satisfies WorkerResult)
  }
  finally {
    if (media.kind === 'photo') {
      await dispose()
    }
  }
}
