import { setTimeout as delay } from 'node:timers/promises'

/** Poll observable state with a deadline; missing behavior fails instead of being skipped. */
export const until = async (read, label) => {
  const end = Date.now() + 30000

  while (Date.now() < end) {
    const result = await read()

    if (result) {
      return result
    }

    await delay(100)
  }

  throw new Error(`Timed out: ${label}`)
}
