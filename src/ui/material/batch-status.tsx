import type { DownloaderModel } from './downloader-model'
import Box from '@mui/material/Box'
import LinearProgress from '@mui/material/LinearProgress'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { t } from '../i18n'

/** Expose indeterminate collection and confirmed receipt progress without announcing every animation. */
export const BatchStatus = ({ model }: { model: DownloaderModel }) => {
  const { batch, status, error } = model.getSnapshot()

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
        <Typography
          id="count"
          variant="caption"
          color="text.secondary"
          aria-live="polite"
        >
          {count}
        </Typography>
      </Box>
      <LinearProgress
        id="download-progress"
        hidden={!batch || batch.phase === 'stopped'}
        aria-label={t('selected')}
        aria-valuetext={!batch?.totalKnown ? `${status} · ${count}` : count}
        variant={batch?.totalKnown ? 'determinate' : 'indeterminate'}
        value={percent}
        color={
          error ? 'error' : batch?.phase === 'finished' ? 'success' : 'primary'
        }
        sx={{ height: 8, borderRadius: 1 }}
      />
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
