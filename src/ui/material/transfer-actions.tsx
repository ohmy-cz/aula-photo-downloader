import type { AlbumSelection, ImmichAlbum, PreparedDestination } from '../../immich/contracts'
import type { DownloaderModel } from './downloader-model'
import AddOutlined from '@mui/icons-material/AddOutlined'
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
import Typography from '@mui/material/Typography'
import { useState, useSyncExternalStore } from 'react'
import { CONFIG } from '../../config'
import { AppError } from '../../errors'
import { request } from '../client'
import { t, translateError } from '../i18n'
import { AlbumPicker } from './album-picker'
import { useTrustedAction } from './use-trusted-action'

/** Choose a destination before importing; keep the dialog and controls locked until all server receipts settle. */
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

  /** Persist a server-validated selection before collection, and close only after a complete successful import. */
  const importAlbum = async () => {
    if (!albums || !selectedId) {
      return
    }

    setError('')

    try {
      const { latestPhotoAt, ...destination } = await request<PreparedDestination>({ type: 'immich-select', destination: { connectionId: albums.connectionId, albumId: selectedId } })

      await model.start(destination, latestPhotoAt)

      if (model.getSnapshot().batch?.phase === 'finished') {
        setOpen(false)
      }
      else {
        setError(model.getSnapshot().status)
      }
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
        disabled={state.loading || (busy && !working) || !!state.controller?.signal.aborted}
        color={working ? 'error' : 'primary'}
        startIcon={working ? <StopOutlined /> : <DownloadOutlined />}
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
        {t(working ? 'stop' : state.immichConnected ? 'import' : 'start')}
      </Button>
      {state.immichConnected && (
        <Link
          component="button"
          id="download-instead"
          type="button"
          disabled={state.loading || busy || working}
          variant="body2"
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
            {working && <Typography role="status" variant="body2">{state.status}</Typography>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={busy || working}>{t('cancel')}</Button>
          {error && <Button disabled={busy || working} onClick={(event) => { void run(event, chooseAlbum) }}>{t('retryAction')}</Button>}
          {working && (
            <Button
              color="error"
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
          <Button id="immich-import" variant="contained" disabled={!albums || !selectedId || creating || busy || working} onClick={(event) => { void run(event, importAlbum) }}>{t('import')}</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
