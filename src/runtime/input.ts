import type { Job } from '../types'
import { CONFIG } from '../config'
import { AppError } from '../errors'
import { mediaUrl } from '../security'
import { readBytes } from '../streams'

/** Fetch only an approved original, without cookies or redirects; streaming also enforces the input cap. */
export const fetchInput = async (
  job: Job,
  fetcher: typeof fetch = fetch,
): Promise<ArrayBuffer> => {
  const url = mediaUrl(job.media.url)

  let response: Response

  try {
    response = await fetcher(url.href, {
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(CONFIG.timing.mediaFetchMs),
    })
  }
  catch (error) {
    throw new AppError(
      error instanceof Error
      && ['TimeoutError', 'AbortError'].includes(error.name)
        ? 'media-timeout'
        : 'media-fetch',
    )
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)

    throw new AppError('media-fetch')
  }

  return (
    await readBytes(
      response,
      CONFIG.limits.mediaBytes,
      'media-fetch',
      'media-size',
    )
  ).buffer
}
