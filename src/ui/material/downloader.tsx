import type { DownloaderModel } from './downloader-model'
import Close from '@mui/icons-material/Close'
import SettingsOutlined from '@mui/icons-material/SettingsOutlined'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import Checkbox from '@mui/material/Checkbox'
import Divider from '@mui/material/Divider'
import FormControlLabel from '@mui/material/FormControlLabel'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import Skeleton from '@mui/material/Skeleton'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { useSyncExternalStore } from 'react'
import { API_VERSION } from '../../api/contracts'
import { t } from '../i18n'
import { BatchStatus } from './batch-status'
import { Brand } from './brand'
import { DateSelection } from './date-selection'
import { TransferActions } from './transfer-actions'

/** Declarative downloader view; privileged actions require a real browser gesture. */
export const Downloader = ({
  model,
  close,
}: {
  model: DownloaderModel
  close: () => void
}) => {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot)

  const { batch, controller } = state

  const busy = !!controller

  return (
    <Card
      component="section"
      className="panel"
      data-phase={batch?.phase ?? 'idle'}
      aria-label="Aula Photo Downloader"
      elevation={8}
      sx={{
        width: 400,
        maxWidth: '100%',
        maxHeight: 'calc(100dvh - 32px)',
        overflowY: 'auto',
        border: 1,
        borderColor: 'divider',
      }}
    >
      <Brand
        action={(
          <Stack direction="row" spacing={0.5}>
            <Tooltip title={t('settings')}>
              <IconButton
                id="settings"
                aria-label={t('settings')}
                size="small"
                disabled={busy}
                onClick={(event) => {
                  if (event.isTrusted) {
                    void model.openSettings()
                  }
                }}
              >
                <SettingsOutlined />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('hide')}>
              <IconButton
                id="close"
                aria-label={t('hide')}
                onClick={close}
                size="small"
              >
                <Close />
              </IconButton>
            </Tooltip>
          </Stack>
        )}
      />
      <Divider />
      <Stack spacing={2} sx={{ p: 2.5 }}>
        <Alert
          id="api-warning"
          severity="warning"
          role="status"
          hidden={state.apiVersion <= API_VERSION}
        >
          {t('newerApiWarning', {
            version: state.apiVersion,
            implementedVersion: API_VERSION,
          })}
        </Alert>
        <Box>
          <Box
            id="file-errors"
            hidden={!state.fileErrors.length}
            sx={{ mb: state.fileErrors.length ? 2 : 0 }}
          >
            <Typography component="h2" variant="subtitle2" color="error.main">
              {t('fileErrors')}
            </Typography>
            <List
              id="file-error-list"
              dense
              disablePadding
              aria-live="polite"
              aria-relevant="additions text"
              sx={{ maxHeight: 160, overflowY: 'auto' }}
            >
              {state.fileErrors.map(row => (
                <ListItem key={row.id} disableGutters>
                  <ListItemText
                    primary={row.filename}
                    secondary={row.reason}
                    sx={{ overflowWrap: 'anywhere' }}
                  />
                </ListItem>
              ))}
            </List>
          </Box>
          <DateSelection model={model} />
        </Box>
        <FormControlLabel
          control={(
            <Checkbox
              id="child-tags"
              checked={state.childTags}
              disabled={state.loading || busy}
              onChange={(event, checked) => {
                if (event.isTrusted) {
                  model.setChildTags(checked)
                }
              }}
            />
          )}
          label={t('includeChildTags')}
        />
        <Typography variant="caption" color="text.secondary">
          {t('locationNotice')}
        </Typography>
        {state.loading && (
          <Skeleton variant="rounded" height={8} aria-label={t('collecting')} />
        )}
        <BatchStatus model={model} />
        <TransferActions model={model} />
      </Stack>
    </Card>
  )
}
