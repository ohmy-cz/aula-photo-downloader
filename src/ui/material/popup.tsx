import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Link from '@mui/material/Link'
import Skeleton from '@mui/material/Skeleton'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useEffect, useState } from 'react'
import { isAlbumPage } from '../../api/gallery'
import { CONFIG } from '../../config'
import { request } from '../client'
import { t } from '../i18n'
import { mountExtensionPage } from './extension-page'
import { useTrustedAction } from './use-trusted-action'

/** Record toolbar activation before injecting the downloader, and close only after Chrome confirms injection. */
const openDownloader = async (tabId: number) => {
  await chrome.storage.session.set({
    [`${CONFIG.archive.activationStorageKey}:${String(tabId)}`]: true,
  })

  await chrome.scripting.executeScript({
    target: { tabId },
    files: [CONFIG.browser.contentScript],
  })

  window.close()
}

/** Open the downloader immediately on an album; retain guidance and retry/history controls when it cannot open. */
const Popup = () => {
  const [loading, setLoading] = useState(true)

  const [tabId, setTabId] = useState<number | null>(null)

  const [message, setMessage] = useState('')

  const { busy, run } = useTrustedAction()

  useEffect(() => {
    let disposed = false

    void chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(async ([tab]) => {
        if (!disposed) {
          const selected = tab?.id !== undefined && tab.url !== undefined && tab.url !== '' && isAlbumPage(tab.url) ? tab.id : null

          setTabId(selected)

          if (selected !== null) {
            await openDownloader(selected)
          }
        }
      })
      .catch(() => {
        if (!disposed) {
          setMessage(t('popupRefresh'))
        }
      })
      .finally(() => {
        if (!disposed) {
          setLoading(false)
        }
      })

    return () => {
      disposed = true
    }
  }, [])

  /** Retry a failed opening without requiring another setup or consent step. */
  const launch = async () => {
    if (tabId === null) {
      return
    }

    try {
      await openDownloader(tabId)
    }
    catch {
      setMessage(t('popupRefresh'))
    }
  }

  /** Clear saved dates only after the background confirms deletion; active downloads preserve them. */
  const clearHistory = async () => {
    try {
      const response = await chrome.runtime.sendMessage<
        unknown,
        { ok?: boolean } | undefined
      >({ type: 'clear-history' })

      setMessage(t(response?.ok ? 'historyCleared' : 'historyBusy'))
    }
    catch {
      setMessage(t('errors.operation'))
    }
  }

  return (
    <Stack spacing={2}>
      <Typography component="h2" variant="h6">
        {t(tabId === null ? 'popupHeading' : 'popupReadyHeading')}
      </Typography>
      <Typography id="message" role="status" variant="body2">
        {message || t(tabId === null ? 'popupMessage' : 'popupReadyMessage')}
      </Typography>
      {loading && <Skeleton variant="rounded" height={120} />}
      <Box hidden={loading || tabId === null}>
        <Button
          id="continue"
          variant="contained"
          disabled={busy || loading}
          onClick={(event) => {
            void run(event, launch)
          }}
        >
          {t('openDownloader')}
        </Button>
      </Box>
      <Box>
        <Button
          id="open-settings"
          fullWidth
          disabled={busy || loading}
          onClick={(event) => {
            void run(event, async () => {
              await request({ type: 'open-settings' })
            })
          }}
        >
          {t('settings')}
        </Button>
        <Button
          id="clear-history"
          variant="outlined"
          fullWidth
          disabled={busy || loading}
          onClick={(event) => {
            void run(event, clearHistory)
          }}
        >
          {t('clearHistory')}
        </Button>
      </Box>
      <Link
        href={`${CONFIG.aula.origin}/portal/${CONFIG.aula.myMediaRoute}`}
        target="_blank"
        rel="noopener noreferrer"
        variant="body2"
      >
        {t('popupLink')}
      </Link>
    </Stack>
  )
}

document.body.style.width = '420px'

mountExtensionPage(<Popup />)
