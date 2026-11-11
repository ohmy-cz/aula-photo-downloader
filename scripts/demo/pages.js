import { CONFIG } from '../../src/config'

// Development-only mocks for the actual packaged popup; no downloads or Aula access.
const parameters = new URL(location.href).searchParams

window.chrome = {
  tabs: {
    query: () =>
      Promise.resolve([
        {
          id: 1,
          url: parameters.has('invalid')
            ? 'https://example.com'
            : `${CONFIG.aula.origin}/portal/${CONFIG.aula.myMediaRoute}`,
        },
      ]),
  },
  storage: {
    session: {
      set: () => Promise.resolve(),
      remove: () => Promise.resolve(),
    },
  },
  scripting: {
    executeScript: () =>
      parameters.has('fail')
        ? Promise.reject(new Error('Synthetic injection failure'))
        : Promise.resolve(),
  },
  runtime: {
    sendMessage: () => Promise.resolve({ ok: !parameters.has('busy') }),
  },
}
