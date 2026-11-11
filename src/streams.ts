import type { ErrorCode } from './errors'
import { AppError } from './errors'

/** Read a response within its byte budget, cancelling and releasing the reader on every exit. */
export const readBytes = async (
  response: Response,
  limit: number,
  missing: ErrorCode,
  tooLarge: ErrorCode,
): Promise<Uint8Array<ArrayBuffer>> => {
  if (!response.body) {
    throw new AppError(missing)
  }

  if (Number(response.headers.get('content-length')) > limit) {
    await response.body.cancel().catch(() => undefined)

    throw new AppError(tooLarge)
  }

  const reader = response.body.getReader()

  const chunks: Uint8Array[] = []

  let length = 0

  try {
    for (;;) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      length += value.byteLength

      if (length > limit) {
        throw new AppError(tooLarge)
      }

      chunks.push(value)
    }
  }
  finally {
    await reader.cancel().catch(() => undefined)

    reader.releaseLock()
  }

  const bytes = new Uint8Array(length)

  let offset = 0

  for (const chunk of chunks) {
    bytes.set(chunk, offset)

    offset += chunk.byteLength
  }

  return bytes
}
