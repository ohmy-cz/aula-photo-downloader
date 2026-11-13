import type { DownloaderModel } from './downloader-model'
import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined'
import Box from '@mui/material/Box'
import LinearProgress from '@mui/material/LinearProgress'
import Skeleton from '@mui/material/Skeleton'
import Stack from '@mui/material/Stack'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { t } from '../i18n'

/** Use skeletons until totals are known and show confirmed import success beside the final count. */
export const BatchStatus = ({ model }: { model: DownloaderModel }) => {
  const { batch, status, error } = model.getSnapshot()

  const imported = batch?.importing && batch.phase === 'finished' && !error

  const count = !batch
    ? ''
    : !batch.totalKnown
        ? t('found', { count: batch.total })
        : t('completed', {
            completed: batch.completed,
            total: batch.total,
            left: batch.total - batch.completed,
          })

  const percent = batch !== null && batch.total > 0
    ? (batch.completed / batch.total) * 100
    : batch?.phase === 'finished'
      ? 100
      : 0

  return (
    <Box hidden={!batch && !status}>
      <Box id="progress-heading" hidden={!batch && !status} sx={{ mb: 1.5 }}>
        {!imported && (
          <Tooltip title={status} describeChild>
            <Typography
              id="phase"
              role="status"
              aria-live="polite"
              variant="body2"
              className={error ? 'error' : undefined}
              color={error ? 'error.main' : 'text.primary'}
              sx={{
                overflowWrap: 'anywhere',
                height: '3em',
                overflow: 'hidden',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
              }}
            >
              {status}
            </Typography>
          </Tooltip>
        )}
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <Typography id="count" variant="caption" color="text.secondary" aria-live="polite">
            {count}
          </Typography>
          {imported && (
            <Typography id="phase" role="status" variant="caption" color="success.main" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, ml: 'auto' }}>
              <CheckCircleOutlined sx={{ fontSize: 16 }} />
              {status}
            </Typography>
          )}
        </Stack>
      </Box>
      <Box id="download-progress" hidden={!batch || batch.phase === 'stopped' || (batch.phase === 'error' && !batch.totalKnown)}>
        {batch?.totalKnown
          ? <LinearProgress aria-label={t('selected')} aria-valuetext={count} variant="determinate" value={percent} color={error ? 'error' : batch.phase === 'finished' ? 'success' : 'primary'} sx={{ height: 8, borderRadius: 1 }} />
          : batch?.phase === 'collecting' && <Skeleton aria-label={t('collecting')} variant="rounded" height={8} />}
      </Box>
      <Typography
        id="failures"
        role="status"
        variant="caption"
        color="error.main"
      >
        {batch !== null && batch.failures > 0 ? t('attention', { count: batch.failures }) : ''}
      </Typography>
    </Box>
  )
}
