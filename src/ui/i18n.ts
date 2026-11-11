import i18next from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { CONFIG } from '../config'
import { AppError, publicErrorCode } from '../errors'
import { required } from '../required'
import cs from './locales/cs.json'
import da from './locales/da.json'
import en from './locales/en.json'
import es from './locales/es.json'

const resources = {
  cs: { translation: cs },
  da: { translation: da },
  en: { translation: en },
  es: { translation: es },
}

/** Bundle all resources and initialize synchronously without network or page-storage access. */
export const createUiI18n = (languages?: readonly string[]) => {
  const instance = i18next.createInstance()

  if (languages === undefined) {
    instance.use(LanguageDetector)
  }

  // An explicit preference list is useful for isolated tests; normalize regional variants.
  const language = languages
    ?.map(value => required(value.toLowerCase().split(/[-_]/)[0]))
    .find(value => CONFIG.i18n.supportedLanguages.includes(value))

  void instance.init({
    resources,
    supportedLngs: CONFIG.i18n.supportedLanguages,
    fallbackLng: CONFIG.i18n.defaultLanguage,
    ...(languages === undefined
      ? {}
      : { lng: language ?? CONFIG.i18n.defaultLanguage }),
    load: 'languageOnly',
    initAsync: false,
    detection: { order: ['navigator'], caches: [] },
    interpolation: { escapeValue: false },
  })

  return instance
}

const instance = createUiI18n()

export const t = instance.t.bind(instance)

export const uiLanguage = (): string =>
  instance.resolvedLanguage !== undefined && instance.resolvedLanguage !== ''
    ? instance.resolvedLanguage
    : CONFIG.i18n.defaultLanguage

/** Display only allowlisted public errors, including local translations. */
export const translateError = (error: unknown): string => {
  if (error instanceof AppError) {
    return t(`errors.${error.code}`)
  }

  const message = error instanceof Error ? error.message : error

  // Local timeout errors may already have been translated by the caller.
  for (const { translation } of Object.values(resources)) {
    for (const [code, value] of Object.entries(translation.errors)) {
      if (message === value) {
        return t(`errors.${code}`)
      }
    }
  }

  return t(`errors.${publicErrorCode(message)}`)
}
