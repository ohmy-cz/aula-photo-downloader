import type { SyntheticEvent } from 'react'
import { useRef, useState } from 'react'

/** Serialize explicit browser gestures; keep controls locked through the caller's confirmed completion. */
export const useTrustedAction = () => {
  const [busy, setBusy] = useState(false)

  const activeRef = useRef(false)

  /** Ignore synthetic/overlapping clicks; propagate action errors after always unlocking the controls. */
  const run = async (event: SyntheticEvent, action: () => Promise<void>) => {
    if (!event.isTrusted || activeRef.current) {
      return
    }

    activeRef.current = true

    setBusy(true)

    try {
      await action()
    }
    finally {
      activeRef.current = false

      setBusy(false)
    }
  }

  return { busy, run }
}
