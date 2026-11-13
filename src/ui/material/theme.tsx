import type { ReactNode } from 'react'
import createCache from '@emotion/cache'
import { CacheProvider } from '@emotion/react'
import { csCZ, daDK, enUS, esES } from '@mui/material/locale'
import ScopedCssBaseline from '@mui/material/ScopedCssBaseline'
import { createTheme, ThemeProvider } from '@mui/material/styles'
import { uiLanguage } from '../i18n'

const locales: Record<string, typeof enUS> = { cs: csCZ, da: daDK, en: enUS, es: esES }

/** Own styles and portals in the same document or shadow root; never restyle Aula itself. */
export const createUiTheme = (container: HTMLElement) => {
  const root = container.getRootNode()

  const cache = createCache({
    key: 'apd',
    prepend: true,
    container: root instanceof ShadowRoot ? root : document.head,
  })

  const theme = createTheme({
    palette: {
      primary: { main: '#145775' },
      secondary: { main: '#62c6cb', contrastText: '#18343f' },
      info: { main: '#145775' },
      background: { default: '#f5f8fa', paper: '#ffffff' },
      text: { primary: '#18343f', secondary: '#526670' },
    },
    typography: {
      htmlFontSize:
        Number.parseFloat(
          getComputedStyle(document.documentElement).fontSize,
        ) || 16,
      fontFamily:
        'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      h6: { fontSize: '16px', fontWeight: 700 },
      button: { textTransform: 'none', fontWeight: 600 },
    },
    shape: { borderRadius: 12 },
    components: {
      ...(locales[uiLanguage()] ?? enUS).components,
      MuiSkeleton: { defaultProps: { animation: 'wave' } },
      MuiStack: { defaultProps: { useFlexGap: true } },
      MuiButton: { defaultProps: { disableElevation: true } },
      MuiTextField: { defaultProps: { size: 'small', fullWidth: true } },
      MuiPopover: { defaultProps: { container } },
      MuiPopper: { defaultProps: { container } },
      MuiModal: { defaultProps: { container } },
      MuiScopedCssBaseline: {
        styleOverrides: {
          root: {
            'colorScheme': 'light',
            'fontSize': '14px',
            '& [hidden]': { display: 'none !important' },
            '@media (prefers-reduced-motion: reduce)': {
              '& *, & *::before, & *::after': {
                animation: 'none !important',
                transition: 'none !important',
              },
            },
          },
        },
      },
    },
  })

  /** Share one stable Emotion cache and theme for the lifetime of this React root. */
  const UiTheme = ({ children }: { children: ReactNode }) => (
    <CacheProvider value={cache}>
      <ThemeProvider theme={theme}>
        <ScopedCssBaseline>{children}</ScopedCssBaseline>
      </ThemeProvider>
    </CacheProvider>
  )

  return UiTheme
}
