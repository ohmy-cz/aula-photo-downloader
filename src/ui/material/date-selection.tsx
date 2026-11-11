import type { DownloaderModel } from './downloader-model'
import Box from '@mui/material/Box'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import { t } from '../i18n'

const fields = [
  ['latest', 'today', 'from', 'newest', 'fromLabel'],
  ['cutoff', 'all', 'to', 'oldest', 'toLabel'],
] as const

/** Keep both date bounds visible while busy; native date inputs preserve browser keyboard support. */
export const DateSelection = ({ model }: { model: DownloaderModel }) => {
  const { dates, controller, loading } = model.getSnapshot()

  return (
    <Box id="selection">
      <Typography variant="subtitle2" component="h2" sx={{ mb: 2 }}>
        {t('download')}
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 2,
        }}
      >
        {fields.map(([date, toggle, label, hint, aria]) => (
          <Box key={date}>
            <Tooltip title={t(hint)} describeChild>
              <Box>
                <TextField
                  id={date}
                  type="date"
                  label={t(label)}
                  value={dates[date]}
                  disabled={loading || !!controller || dates[toggle]}
                  onChange={(event) => {
                    model.setDates({ [date]: event.target.value })
                  }}
                  slotProps={{
                    inputLabel: { shrink: true },
                    htmlInput: { 'aria-label': t(aria) },
                  }}
                />
              </Box>
            </Tooltip>
            <FormControlLabel
              sx={{ mr: 0 }}
              label={t(toggle)}
              control={(
                <Checkbox
                  id={toggle}
                  size="small"
                  checked={dates[toggle]}
                  disabled={loading || !!controller}
                  onChange={(_, checked) => {
                    model.setDates({ [toggle]: checked })
                  }}
                />
              )}
            />
          </Box>
        ))}
      </Box>
    </Box>
  )
}
