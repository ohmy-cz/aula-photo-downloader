import type { ConnectionStatus } from '../../immich/contracts'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Skeleton from '@mui/material/Skeleton'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useEffect, useState } from 'react'
import { AppError } from '../../errors'
import { ApiKey, immichPermission, immichUrl } from '../../immich/contracts'
import { request } from '../client'
import { t, translateError } from '../i18n'
import { mountExtensionPage } from './extension-page'
import { useTrustedAction } from './use-trusted-action'

/** Configure one user-selected server in a standard extension options tab; credentials never enter the Aula page. */
const Options = () => {
  const [loading, setLoading] = useState(true)

  const [status, setStatus] = useState<ConnectionStatus>({ connected: false, server: '', keyLength: 0 })

  const [server, setServer] = useState('')

  const [apiKey, setApiKey] = useState('')

  const [error, setError] = useState('')

  const { busy, run } = useTrustedAction()

  useEffect(() => {
    let disposed = false

    void request<ConnectionStatus>({ type: 'immich-status' }).then((value) => {
      if (!disposed) {
        setStatus(value)

        setServer(value.server)

        setApiKey('*'.repeat(value.keyLength))
      }
    }).catch((error: unknown) => {
      if (!disposed) {
        setError(translateError(error))
      }
    }).finally(() => {
      if (!disposed) {
        setLoading(false)
      }
    })

    return () => {
      disposed = true
    }
  }, [])

  /** Keep stars out of key updates; reusing a saved key is allowed only for its original server, after server verification. */
  const connect = async () => {
    setError('')

    try {
      const canonical = immichUrl(server)

      const keepKey = status.keyLength > 0 && /^\*+$/.test(apiKey)

      if ((keepKey && canonical !== status.server) || (!keepKey && !ApiKey.safeParse(apiKey).success)) {
        throw new AppError('immich-config')
      }

      if (!await chrome.permissions.request({ origins: [immichPermission(canonical)] })) {
        throw new AppError('immich-permission')
      }

      const value = await request<ConnectionStatus>({ type: 'immich-connect', server: canonical, ...(keepKey ? {} : { apiKey }) })

      const previous = status.server

      setStatus(value)

      setServer(value.server)

      setApiKey('*'.repeat(value.keyLength))

      if (previous && immichPermission(previous) !== immichPermission(value.server)) {
        await chrome.permissions.remove({ origins: [immichPermission(previous)] }).catch(() => false)
      }
    }
    catch (error) {
      setError(translateError(error))
    }
  }

  /** Forget the key and last album only after the background excludes active work, then release its optional host grant. */
  const disconnect = async () => {
    setError('')

    try {
      const value = await request<ConnectionStatus>({ type: 'immich-disconnect' })

      if (status.server) {
        await chrome.permissions.remove({ origins: [immichPermission(status.server)] }).catch(() => false)
      }

      setStatus(value)

      setServer('')

      setApiKey('')
    }
    catch (error) {
      setError(translateError(error))
    }
  }

  return (
    <Stack
      spacing={2}
      component="form"
      onSubmit={(event) => {
        event.preventDefault()

        void run(event, connect)
      }}
    >
      <Typography component="h2" variant="h6">{t('settings')}</Typography>
      <Typography variant="body2">{t('immichDescription')}</Typography>
      {loading && <Skeleton variant="rounded" height={120} />}
      {error && <Alert severity="error">{error}</Alert>}
      <Alert id="connection-status" severity={status.connected ? 'success' : 'info'} role="status">
        {status.connected ? t('immichConnected', { server: status.server }) : t('immichDisconnected')}
      </Alert>
      <TextField id="immich-server" label={t('immichServer')} value={server} required disabled={loading || busy} onChange={event => setServer(event.target.value)} />
      <TextField id="immich-key" label={t('immichKey')} type="password" autoComplete="off" value={apiKey} required disabled={loading || busy} onChange={event => setApiKey(event.target.value)} />
      <Typography variant="subtitle2">{t('immichPermissions')}</Typography>
      <Typography component="ul" variant="body2" sx={{ pl: 2.5, m: 0 }}>
        <li>
          <code>user.read</code>
          {' '}
          —
          {' '}
          {t('immichPermissionUser')}
        </li>
        <li>
          <code>album.read</code>
          {' '}
          —
          {' '}
          {t('immichPermissionAlbums')}
        </li>
        <li>
          <code>album.create</code>
          {' '}
          —
          {' '}
          {t('immichPermissionCreate')}
        </li>
        <li>
          <code>asset.read</code>
          {' '}
          —
          {' '}
          {t('immichPermissionDate')}
        </li>
        <li>
          <code>asset.view</code>
          {' '}
          —
          {' '}
          {t('immichPermissionView')}
        </li>
        <li>
          <code>asset.upload</code>
          {' '}
          —
          {' '}
          {t('immichPermissionUpload')}
        </li>
        <li>
          <code>albumAsset.create</code>
          {' '}
          —
          {' '}
          {t('immichPermissionAdd')}
        </li>
      </Typography>
      {status.server && <Button id="immich-manage-key" component="a" href={`${status.server}/user-settings?isOpen=api-keys`} target="_blank" rel="noopener noreferrer" disabled={loading || busy}>{t('immichManageKey')}</Button>}
      <Stack direction="row" spacing={1}>
        <Button id="immich-connect" type="submit" variant="contained" disabled={loading || busy}>{t('immichConnect')}</Button>
        <Button id="immich-disconnect" onClick={(event) => { void run(event, disconnect) }} disabled={loading || busy || !status.server}>{t('immichDisconnect')}</Button>
      </Stack>
    </Stack>
  )
}

mountExtensionPage(<Options />)
