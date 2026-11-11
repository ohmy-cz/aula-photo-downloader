import { Buffer } from 'node:buffer'
import { decodeUInt32, encodeU32 } from '@webassemblyjs/leb128'

/** Cap the pinned photo runtime's single memory without changing its code or data; fail on an unexpected layout. */
export const capPhotoMemory = (bytes, maximumBytes) => {
  const maximum = maximumBytes / 65536

  if (!Number.isInteger(maximum) || maximum < 1 || maximum > 65536 || !WebAssembly.validate(bytes)) {
    throw new Error('Invalid photo WASM memory budget or module.')
  }

  for (let offset = 8; offset < bytes.length;) {
    const sectionStart = offset

    const id = bytes[offset++]

    const size = decodeUInt32(bytes, offset)

    const end = size.nextIndex + size.value

    if (id === 5) {
      const count = decodeUInt32(bytes, size.nextIndex)

      const flags = decodeUInt32(bytes, count.nextIndex)

      const initial = decodeUInt32(bytes, flags.nextIndex)

      if (count.value !== 1 || flags.value !== 0 || initial.nextIndex !== end || initial.value > maximum) {
        throw new Error('Unexpected photo WASM memory layout.')
      }

      const memory = Buffer.from([1, 1, ...encodeU32(initial.value), ...encodeU32(maximum)])

      const capped = Buffer.concat([
        bytes.subarray(0, sectionStart),
        Buffer.from([5, ...encodeU32(memory.length)]),
        memory,
        bytes.subarray(end),
      ])

      if (!WebAssembly.validate(capped)) {
        throw new Error('Invalid capped photo WASM.')
      }

      return capped
    }

    offset = end
  }

  throw new Error('Photo WASM memory missing.')
}
