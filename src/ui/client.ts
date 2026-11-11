import type { ProcessResult, Request } from '../types'
import { sleep } from '../async'
import { CONFIG } from '../config'
import { AppError, publicErrorCode } from '../errors'
import { t } from './i18n'

/** The background owns operation receipts, so closing the panel does not lose an active job. */
export const request = async <T>(message: Request): Promise<T> => {
  const response = await chrome.runtime.sendMessage<
    unknown,
    Record<string, unknown> | undefined
  >(message)

  if (!response) {
    throw new Error(t('errors.reload'))
  }

  const failed = Boolean(response.error)

  if (failed) {
    throw new AppError(publicErrorCode(response.error))
  }

  return response as T
}

/** Poll short-lived messages instead of keeping a service-worker response open for minutes. */
export const waitForOperation = async (
  message: Request,
  timeoutMessage: string,
  options: { signal?: AbortSignal, pollMs?: number } = {},
): Promise<Exclude<ProcessResult, { mode: 'working' }>> => {
  const { signal, pollMs = CONFIG.timing.pollMs } = options

  const started = Date.now()

  let result = await request<ProcessResult>(message)

  for (;;) {
    signal?.throwIfAborted()

    if (result.mode !== 'working') {
      return result
    }

    if (Date.now() - started > CONFIG.timing.operationMs) {
      throw new Error(timeoutMessage)
    }

    const operation = result.operation

    await sleep(pollMs, signal)

    signal?.throwIfAborted()

    result = await request<ProcessResult>({ type: 'status', operation })
  }
}
