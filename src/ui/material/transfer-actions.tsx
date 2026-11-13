import type { AlbumSelection, ImmichAlbum, PreparedDestination } from '../../immich/contracts'
import type { DownloaderModel } from './downloader-model'
import AddOutlined from '@mui/icons-material/AddOutlined'
import CloudUploadOutlined from '@mui/icons-material/CloudUploadOutlined'
import DownloadOutlined from '@mui/icons-material/DownloadOutlined'
import StopOutlined from '@mui/icons-material/StopOutlined'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Link from '@mui/material/Link'
import Skeleton from '@mui/material/Skeleton'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import { useState, useSyncExternalStore } from 'react'
import { CONFIG } from '../../config'
import { AppError } from '../../errors'
import { request } from '../client'
import { t, translateError } from '../i18n'
import { AlbumPicker } from './album-picker'
import { useTrustedAction } from './use-trusted-action'

/** Confirm the destination in the picker, then show the transfer and its receipts in the main panel. */
export const TransferActions = ({ model }: { model: DownloaderModel }) => {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot)

  const [open, setOpen] = useState(false)

  const [albums, setAlbums] = useState<AlbumSelection | null>(null)

  const [selectedId, setSelectedId] = useState('')

  const [error, setError] = useState('')

  const [creating, setCreating] = useState(false)

  const [albumName, setAlbumName] = useState('')

  const [createError, setCreateError] = useState('')

  const { busy, run } = useTrustedAction()

  const working = state.controller !== null

  /** Refresh writable albums each time; stale or deleted remembered choices fall back to the newest available album. */
  const chooseAlbum = async () => {
    setOpen(true)

    setAlbums(null)

    setError('')

    setCreating(false)

    try {
      const value = await request<AlbumSelection>({ type: 'immich-albums' })

      setAlbums(value)

      setSelectedId(value.selectedId ?? '')
    }
    catch (error) {
      setError(translateError(error))
    }
  }

  /** Keep the form locked until creation is confirmed; failures retain the entered name and current selection for retry. */
  const createAlbum = async () => {
    if (!albums) {
      return
    }

    setCreateError('')

    try {
      const album = await request<ImmichAlbum>({ type: 'immich-create-album', connectionId: albums.connectionId, name: albumName })

      setAlbums({ ...albums, albums: [album, ...albums.albums] })

      setSelectedId(album.id)

      setCreating(false)
    }
    catch (error) {
      setCreateError(error instanceof AppError && error.code === 'immich-auth' ? t('immichCreatePermission') : translateError(error))
    }
  }

  /** Close after the destination is confirmed; preparation failures stay in the picker, transfer failures stay in the panel. */
  const importAlbum = async () => {
    if (!albums || !selectedId) {
      return
    }

    setError('')

    try {
      const { latestPhotoAt, ...destination } = await request<PreparedDestination>({ type: 'immich-select', destination: { connectionId: albums.connectionId, albumId: selectedId } })

      setOpen(false)

      await model.start(destination, latestPhotoAt)
    }
    catch (error) {
      setError(translateError(error))
    }
  }

  return (
    <Stack spacing={1} sx={{ alignItems: 'center' }}>
      <Button
        id="toggle"
        variant="contained"
        size="large"
        fullWidth
        autoFocus
        disabled={state.loading || (state.immichConnected ? busy || working : (busy && !working) || !!state.controller?.signal.aborted)}
        color={working && !state.immichConnected ? 'error' : 'primary'}
        startIcon={state.immichConnected ? <CloudUploadOutlined /> : working ? <StopOutlined /> : <DownloadOutlined />}
        onClick={(event) => {
          if (event.isTrusted) {
            if (working) {
              model.stop()
            }
            else {
              if (state.immichConnected) {
                void run(event, chooseAlbum)
              }
              else {
                void model.start()
              }
            }
          }
        }}
      >
        {t(state.immichConnected ? 'chooseAlbumAndImport' : working ? 'stop' : 'start')}
      </Button>
      {state.immichConnected && working && (
        <Button
          id="stop"
          color="error"
          variant="outlined"
          startIcon={<StopOutlined />}
          disabled={!!state.controller?.signal.aborted}
          onClick={(event) => {
            if (event.isTrusted) {
              model.stop()
            }
          }}
        >
          {t('stop')}
        </Button>
      )}
      {state.immichConnected && (
        <Link
          component="button"
          id="download-instead"
          type="button"
          disabled={state.loading || busy || working}
          variant="body2"
          sx={{ '&:disabled': { color: 'action.disabled', textDecoration: 'none' } }}
          onClick={(event) => {
            if (event.isTrusted) {
              void model.start()
            }
          }}
        >
          {t('downloadInstead')}
        </Link>
      )}
      <Dialog
        open={open}
        onClose={() => {
          if (!busy && !working) {
            setOpen(false)
          }
        }}
        fullWidth
        maxWidth="xs"
        aria-labelledby="immich-album-title"
      >
        <DialogTitle id="immich-album-title">{t('immichChooseAlbum')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {!albums && !error && <Skeleton variant="rounded" height={56} />}
            {albums && busy && !creating && <Skeleton variant="rounded" height={8} />}
            {error && <Alert severity="error">{error}</Alert>}
            {albums && (albums.albums.length
              ? (
                  <AlbumPicker key={albums.connectionId} selection={albums} selectedId={selectedId} disabled={creating || busy || working} onChange={setSelectedId} />
                )
              : <Alert severity="info">{t('immichNoAlbums')}</Alert>)}
            {albums && (creating
              ? (
                  <Stack
                    id="immich-create-form"
                    component="form"
                    spacing={1}
                    onSubmit={(event) => {
                      event.preventDefault()

                      void run(event, createAlbum)
                    }}
                  >
                    <TextField id="immich-album-name" label={t('immichAlbumName')} value={albumName} onChange={event => setAlbumName(event.target.value)} autoFocus required disabled={busy} slotProps={{ htmlInput: { maxLength: CONFIG.limits.nameCharacters } }} />
                    {createError && <Alert severity="error">{createError}</Alert>}
                    <Stack direction="row" spacing={1}>
                      <Button id="immich-create-submit" type="submit" variant="contained" disabled={busy || !albumName.trim()}>{t('immichCreateAlbum')}</Button>
                      <Button id="immich-create-cancel" disabled={busy} onClick={() => setCreating(false)}>{t('cancel')}</Button>
                    </Stack>
                  </Stack>
                )
              : (
                  <Button
                    id="immich-create"
                    startIcon={<AddOutlined />}
                    disabled={busy || working}
                    onClick={() => {
                      setAlbumName('')

                      setCreateError('')

                      setCreating(true)
                    }}
                  >
                    {t('immichCreateAlbum')}
                  </Button>
                ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={busy || working}>{t('cancel')}</Button>
          {error && <Button disabled={busy || working} onClick={(event) => { void run(event, chooseAlbum) }}>{t('retryAction')}</Button>}
          <Button id="immich-import" variant="contained" disabled={!albums || !selectedId || creating || busy || working} onClick={(event) => { void run(event, importAlbum) }}>{t('import')}</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
