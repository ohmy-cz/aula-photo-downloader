/** A small immutable snapshot store; subscriptions belong to the mounted React view. */
export const createStore = <T extends object>(initial: T) => {
  let state = initial

  const listeners = new Set<() => void>()

  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },
    update: (patch: Partial<T>) => {
      state = { ...state, ...patch }

      for (const listener of listeners) {
        listener()
      }
    },
  }
}
