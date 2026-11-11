/** An abortable delay keeps page pacing and polling responsive to Stop. */
export const sleep = async (ms: number, signal?: AbortSignal): Promise<void> => {
  if (signal?.aborted) {
    return Promise.reject(new Error('Stopped. Progress is saved.'))
  }

  return new Promise((resolve, reject) => {
    /** Cancel this delay's timer and detach its listener before rejecting the waiting operation. */
    const abort = () => {
      clearTimeout(timer)

      signal?.removeEventListener('abort', abort)

      reject(new Error('Stopped. Progress is saved.'))
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)

      resolve()
    }, ms)

    signal?.addEventListener('abort', abort, { once: true })
  })
}
