import type { ReactNode } from 'react'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import brandIcon from '../../../static/icons/source.svg'

/** Consistent identity across the floating panel and extension-owned pages. */
export const Brand = ({ action }: { action?: ReactNode }) => (
  <Stack direction="row" spacing={1.5} sx={{ p: 2.5, alignItems: 'center' }}>
    <Box component="img" src={brandIcon} alt="" width={36} height={36} sx={{ flexShrink: 0 }} />
    <Typography component="h1" variant="h6" sx={{ flex: 1 }}>
      Aula Photo Downloader
    </Typography>
    {action}
  </Stack>
)
