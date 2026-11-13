import type { ReactNode } from 'react'
import Box from '@mui/material/Box'
import Divider from '@mui/material/Divider'
import Link from '@mui/material/Link'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { createRoot } from 'react-dom/client'
import { CONFIG } from '../../config'
import { required } from '../../required'
import { t, uiLanguage } from '../i18n'
import { Brand } from './brand'
import { createUiTheme } from './theme'

/** Extension-owned shell with privacy and affiliation notices on every privileged page. */
const ExtensionPage = ({ children }: { children: ReactNode }) => (
  <Box sx={{ minHeight: '100vh', p: 2, bgcolor: 'background.default' }}>
    <Paper
      variant="outlined"
      sx={{ maxWidth: 600, mx: 'auto', overflow: 'hidden' }}
    >
      <Brand />
      <Divider />
      <Box component="main" sx={{ p: 2.5 }}>
        {children}
      </Box>
      <Divider />
      <Box component="footer" sx={{ px: 2.5, py: 2 }}>
        <Typography
          variant="caption"
          sx={{ display: 'block', mb: 1, color: 'grey.600', textAlign: 'center', fontSize: '10px' }}
        >
          {t('independent')}
        </Typography>
        <Link
          href={CONFIG.browser.privacyPage}
          target="_blank"
          rel="noopener noreferrer"
          variant="caption"
          sx={{ display: 'block', fontSize: '10px', textAlign: 'center', color: 'grey.600' }}
        >
          {t('privacy')}
        </Link>
      </Box>
    </Paper>
  </Box>
)

/** Mount a packaged React page with no external styles, fonts, scripts or runtime requests. */
export const mountExtensionPage = (children: ReactNode) => {
  document.documentElement.lang = uiLanguage()

  document.body.style.margin = '0'

  const container = required(document.getElementById('root'))

  const UiTheme = createUiTheme(container)

  createRoot(container).render(
    <UiTheme>
      <ExtensionPage>{children}</ExtensionPage>
    </UiTheme>,
  )
}
