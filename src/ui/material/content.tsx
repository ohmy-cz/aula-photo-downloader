import { createRoot } from 'react-dom/client'
import { CONFIG } from '../../config'
import { uiLanguage } from '../i18n'
import { Downloader } from './downloader'
import { createDownloaderModel } from './downloader-model'
import { createUiTheme } from './theme'

/** Mount once in Aula's isolated content-script world; keep styles, focus and portals inside the shadow root. */
const mount = () => {
  const previous = document.getElementById(CONFIG.browser.panelId)

  if (previous) {
    previous.hidden = false

    previous.dispatchEvent(new Event('apd-reopen'))

    return
  }

  const host = document.createElement('div')

  host.id = CONFIG.browser.panelId

  host.lang = uiLanguage()

  host.style.cssText
    = 'position:fixed;bottom:16px;right:16px;z-index:2147483647;max-width:calc(100vw - 32px)'

  for (const name of ['click', 'focusin', 'keydown']) {
    host.addEventListener(name, (event) => {
      event.stopPropagation()
    })
  }

  const shadow = host.attachShadow({ mode: 'open' })

  const container = document.createElement('div')

  shadow.appendChild(container)

  document.documentElement.appendChild(host)

  const UiTheme = createUiTheme(container)

  const model = createDownloaderModel()

  let previousFocus = document.activeElement as HTMLElement | null

  /** Hide the modeless view and return focus while any in-flight receipt finishes in the background. */
  const close = () => {
    model.stop()

    host.hidden = true

    previousFocus?.focus()
  }

  host.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      close()
    }
  })

  host.addEventListener('apd-reopen', () => {
    previousFocus = document.activeElement as HTMLElement | null

    shadow.getElementById('toggle')?.focus()

    model.refresh()
  })

  window.addEventListener('hashchange', model.navigate)

  window.addEventListener('focus', model.refreshConnection)

  createRoot(container).render(
    <UiTheme>
      <Downloader model={model} close={close} />
    </UiTheme>,
  )

  model.refresh()
}

mount()
