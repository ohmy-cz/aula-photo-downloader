import type { AlbumSelection, PreparedDestination } from '../../immich/contracts'
import type { DownloaderModel } from './downloader-model'
import DownloadOutlined from '@mui/icons-material/DownloadOutlined'
import StopOutlined from '@mui/icons-material/StopOutlined'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Link from '@mui/material/Link'
import MenuItem from '@mui/material/MenuItem'
import Skeleton from '@mui/material/Skeleton'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useState, useSyncExternalStore } from 'react'
import { request } from '../client'
import { t, translateError } from '../i18n'
import { useTrustedAction } from './use-trusted-action'

/** Choose a destination before importing; keep the dialog and controls locked until all server receipts settle. */
export const TransferActions = ({ model }: { model: DownloaderModel }) => {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot)

  const [open, setOpen] = useState(false)

  const [albums, setAlbums] = useState<AlbumSelection | null>(null)

  const [selectedId, setSelectedId] = useState('')

  const [error, setError] = useState('')

  const { busy, run } = useTrustedAction()

  const working = state.controller !== null

  /** Refresh writable albums each time; stale or deleted remembered choices fall back to the newest available album. */
  const chooseAlbum = async () => {
    setOpen(true)

    setAlbums(null)

    setError('')

    try {
      const value = await request<AlbumSelection>({ type: 'immich-albums' })

      setAlbums(value)

      setSelectedId(value.selectedId ?? '')
    }
    catch (error) {
      setError(translateError(error))
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
                  <TextField id="immich-album" select label={t('immichAlbum')} value={selectedId} disabled={busy || working} onChange={event => setSelectedId(event.target.value)}>
                    {albums.albums.map(album => <MenuItem key={album.id} value={album.id} id={`immich-album-${album.id}`}>{album.name}</MenuItem>)}
                  </TextField>
                )
              : <Alert severity="info">{t('immichNoAlbums')}</Alert>)}
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
          <Button id="immich-import" variant="contained" disabled={!albums || !selectedId || busy || working} onClick={(event) => { void run(event, importAlbum) }}>{t('import')}</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
