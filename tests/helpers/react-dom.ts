import { afterEach } from 'node:test'
import { JSDOM } from 'jsdom'
import { required } from '../../src/required'

const documents = new Set<JSDOM>()

afterEach(() => {
  for (const dom of documents) {
    dom.window.close()
  }

  documents.clear()
})

/** Own each synthetic browser until test cleanup, including failed assertions and multiple page sessions. */
export const createDom = (...options: ConstructorParameters<typeof JSDOM>) => {
  const dom = new JSDOM(...options)

  documents.add(dom)

  return dom
}

/** Capture delegated bubble listeners so tests can model a trusted gesture without weakening production guards. */
export const trustedEvents = (window: JSDOM['window']) => {
  const listeners = new WeakMap<EventTarget, EventListener[]>()

  const add = required(
    Object.getOwnPropertyDescriptor(
      window.EventTarget.prototype,
      'addEventListener',
    ),
  ).value as typeof window.EventTarget.prototype.addEventListener

  /** Preserve EventTarget's dynamic receiver so delegated listeners are captured against their actual DOM target. */
  window.EventTarget.prototype.addEventListener = function (
    type,
    listener,
    options,
  ) {
    if (
      type === 'click'
      && typeof listener === 'function'
      && options !== true
      && !(typeof options === 'object' && options.capture)
    ) {
      listeners.set(this, [...(listeners.get(this) ?? []), listener])
    }

    add.call(this, type, listener, options)
  }

  return async (target: HTMLElement) => {
    if ((target as HTMLButtonElement).disabled) {
      return
    }

    const native = new window.MouseEvent('click', {
      bubbles: true,
      composed: true,
    })

    const event = new Proxy(native, {
      get: (object, property) => {
        if (property === 'isTrusted') {
          return true
        }

        if (property === 'target') {
          return target
        }

        const value: unknown = Reflect.get(object, property, object)

        const result: unknown
          = typeof value === 'function' ? value.bind(object) : value

        return result
      },
    })

    for (let node: Node | null = target; node; node = node.parentNode) {
      for (const listener of listeners.get(node) ?? []) {
        listener.call(node, event)
      }
    }

    await new Promise(resolve => setTimeout(resolve, 0))
  }
}

/** Dispatch native input events through React's value tracker, just as typing into a controlled field would. */
export const changeInput = async (
  window: JSDOM['window'],
  input: HTMLInputElement,
  value: string,
) => {
  const descriptor = required(
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value'),
  )

  descriptor.set?.call(input, value)

  input.dispatchEvent(
    new window.Event('input', { bubbles: true, composed: true }),
  )

  input.dispatchEvent(
    new window.Event('change', { bubbles: true, composed: true }),
  )

  await new Promise(resolve => setTimeout(resolve, 0))
}
