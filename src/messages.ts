import type { Media } from './types'
import { z } from 'zod'
import { CONFIG } from './config'
import { captureFor } from './metadata/dates'
import {
  cleanNames,
  mediaName,
  mediaUrl,
  safeName,
  validDay,
} from './security'
import { PositiveId } from './validation'

const MediaInput = z.object({
  id: PositiveId,
  position: PositiveId,
  order: z.enum(['asc', 'desc']),
  kind: z.enum(['photo', 'video']),
  day: z.custom<string>(validDay).nullable(),
  filename: z
    .string()
    .refine(value => value === safeName(value))
    .transform(mediaName),
  children: z
    .array(
      z
        .string()
        .refine(value => value.length <= CONFIG.limits.nameCharacters),
    )
    .max(CONFIG.limits.childTags)
    .transform(cleanNames),
  url: z.unknown().transform(value => mediaUrl(value).href),
  size: z.number().nonnegative().nullable().catch(null),
})

/** Validate untrusted tab data and recompute its capture plan at the privilege boundary. */
export const validatedMedia = (input: unknown): Media => {
  const value = MediaInput.parse(input)

  return {
    ...value,
    capture: captureFor(value.filename, value.day, value.position, value.order),
  }
}

/** Only this extension's content script on the exact Aula origin can start a run. */
export const isAulaSender = (sender: chrome.runtime.MessageSender): boolean => {
  if (sender.id !== chrome.runtime.id || !sender.tab || sender.url === undefined || sender.url === '') {
    return false
  }

  try {
    return new URL(sender.url).origin === CONFIG.aula.origin
  }
  catch {
    return false
  }
}

/** Accept worker completion only from this extension’s offscreen document, never a tab or another extension. */
export const isOffscreenSender = (
  sender: chrome.runtime.MessageSender,
): boolean => {
  return (
    sender.id === chrome.runtime.id
    && !sender.tab
    && sender.url === chrome.runtime.getURL(CONFIG.browser.offscreenPage)
  )
}
