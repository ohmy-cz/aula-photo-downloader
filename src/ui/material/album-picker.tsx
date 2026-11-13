import type { AlbumSelection, ImmichAlbum } from '../../immich/contracts'
import PhotoOutlined from '@mui/icons-material/PhotoOutlined'
import Alert from '@mui/material/Alert'
import Autocomplete from '@mui/material/Autocomplete'
import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Skeleton from '@mui/material/Skeleton'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppError } from '../../errors'
import { request } from '../client'
import { t } from '../i18n'

/** Fetch a cover only when its option becomes visible; failed or empty covers remain selectable. */
const AlbumThumbnail = ({ album, load }: { album: ImmichAlbum, load: (album: ImmichAlbum) => Promise<string | null> }) => {
  const elementRef = useRef<HTMLDivElement>(null)

  const [src, setSrc] = useState<string | null>(null)

  const [loading, setLoading] = useState(album.thumbnailId !== null)

  useEffect(() => {
    if (!elementRef.current || album.thumbnailId === null) {
      return
    }

    let active = true

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some(entry => entry.isIntersecting)) {
        return
      }

      observer.disconnect()

      void load(album).then((value) => {
        if (active) {
          setSrc(value)

          setLoading(false)
        }
      })
    })

    observer.observe(elementRef.current)

    return () => {
      active = false

      observer.disconnect()
    }
  }, [album, load])

  return (
    <Box ref={elementRef} sx={{ width: 40, height: 40, flexShrink: 0 }}>
      {loading
        ? <Skeleton variant="rounded" width={40} height={40} />
        : <Avatar variant="rounded" src={src ?? undefined} alt="" sx={{ width: 40, height: 40 }}><PhotoOutlined /></Avatar>}
    </Box>
  )
}

/** Use MUI filtering and keyboard navigation; cache previews only for this dialog and keep credentials in the background. */
export const AlbumPicker = ({ selection, selectedId, disabled, onChange }: {
  selection: AlbumSelection
  selectedId: string
  disabled: boolean
  onChange: (id: string) => void
}) => {
  const previewsRef = useRef(new Map<string, Promise<string | null>>())

  const [permissionMissing, setPermissionMissing] = useState(false)

  const load = useCallback(async (album: ImmichAlbum): Promise<string | null> => {
    if (album.thumbnailId === null) {
      return Promise.resolve(null)
    }

    const cached = previewsRef.current.get(album.id)

    if (cached) {
      return cached
    }

    const pending = request<{ src: string }>({
      type: 'immich-thumbnail',
      destination: { connectionId: selection.connectionId, albumId: album.id },
      assetId: album.thumbnailId,
    }).then(value => value.src).catch((error: unknown) => {
      if (error instanceof AppError && error.code === 'immich-auth') {
        setPermissionMissing(true)
      }

      return null
    })

    previewsRef.current.set(album.id, pending)

    return pending
  }, [selection.connectionId])

  return (
    <Stack spacing={1}>
      <Autocomplete
        id="immich-album"
        options={selection.albums}
        value={selection.albums.find(album => album.id === selectedId) ?? null}
        getOptionLabel={album => album.name}
        getOptionKey={album => album.id}
        isOptionEqualToValue={(option, value) => option.id === value.id}
        disabled={disabled}
        clearOnBlur={false}
        onInputChange={(_, __, reason) => {
          if (reason === 'input') {
            onChange('')
          }
        }}
        onChange={(_, album) => onChange(album?.id ?? '')}
        renderInput={params => <TextField {...params} label={t('immichAlbum')} />}
        renderOption={({ key, ...props }, album) => (
          <Box component="li" key={key} {...props} sx={{ gap: 1.5 }}>
            <AlbumThumbnail album={album} load={load} />
            <Box component="span" sx={{ overflowWrap: 'anywhere' }}>{album.name}</Box>
          </Box>
        )}
      />
      {permissionMissing && <Alert severity="info">{t('immichThumbnailPermission')}</Alert>}
    </Stack>
  )
}
