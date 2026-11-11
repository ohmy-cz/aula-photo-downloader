/** Public messages and diagnostic codes never contain upstream payloads or raw exceptions. */
export const ERROR_MESSAGES = {
  'original-unavailable':
    'An original is unavailable. It will be retried next time.',
  'operation-timeout':
    'This file is taking too long. Check downloads, then press Start.',
  'capture-missing': 'No usable capture date. No file was downloaded.',
  'activation-required': 'Open the extension from your Aula album first.',
  'reload': 'Reload the extension and refresh Aula.',
  'gallery-open': 'Open an Aula gallery first.',
  'album-open': 'Open My media or a specific album.',
  'album-load': 'Let Aula load this album, then try again.',
  'cutoff-invalid': 'Choose a valid cutoff date.',
  'upper-invalid': 'Choose a valid upper date.',
  'range-reversed': 'The date range is reversed.',
  'download-failed': 'Download failed. Press Start to retry.',
  'download-url': 'The final download URL was unexpected. Retry from Aula.',
  'download-not-started': 'The download was not started. Retry from Aula.',
  'worker-closed': 'The processing worker was closed. Retry from Aula.',
  'download-start': 'Could not start the file download. Press Start to retry.',
  'file-retry': 'This file needs a retry. Press Start.',
  'download-review': 'Multiple matching downloads need review before retrying.',
  'collection-limit':
    'This selection is too large. Choose a smaller date range.',
  'api-version':
    'This Aula API version is not supported. Update the extension.',
  'api-contract':
    'Aula\'s response structure has changed. Update the extension before collecting.',
  'api-login': 'Your Aula session has expired. Log in again and press Start.',
  'api-unavailable': 'Aula is temporarily unavailable. Try again later.',
  'api-pagination':
    'Aula returned inconsistent pages. Collection stopped; try again later.',
  'storage-quota':
    'Import dates could not be saved because browser storage is full.',
  'storage-write':
    'Progress could not be saved. Check browser storage before retrying.',
  'worker-busy':
    'Another file is still processing. Wait for it to finish, then press Start.',
  'worker-unavailable': 'Browser processing failed. No file was downloaded.',
  'media-size':
    'This file exceeds the browser processing limit. No file was downloaded.',
  'media-fetch':
    'The original could not be fetched. Refresh the gallery and retry.',
  'media-timeout': 'Browser processing timed out. No file was downloaded.',
  'operation': 'Could not finish this operation. Check downloads and retry.',
  'immich-config': 'Connect to Immich in extension settings first.',
  'immich-permission': 'Allow access to the selected Immich server to connect.',
  'immich-auth': 'Immich rejected the API key or its permissions. Check extension settings.',
  'immich-unavailable': 'Could not reach Immich. Check the server and try again.',
  'immich-contract': 'Immich returned an unsupported response. Update the extension.',
  'immich-album': 'Immich could not add the file to the selected album. Check album access and retry.',

} as const

export type ErrorCode = keyof typeof ERROR_MESSAGES

export class AppError extends Error {
  /** Retain only an allowlisted code across extension message boundaries. */
  constructor(public readonly code: ErrorCode) {
    super(ERROR_MESSAGES[code])

    this.name = 'AppError'
  }
}

/** Convert arbitrary failures to a public, privacy-safe category. */
export const errorCode = (error: unknown): ErrorCode =>
  error instanceof AppError ? error.code : 'operation'

/** Recognize only current public error codes; never expose arbitrary exceptions. */
export const publicErrorCode = (value: unknown): ErrorCode =>
  typeof value === 'string' && Object.hasOwn(ERROR_MESSAGES, value)
    ? (value as ErrorCode)
    : 'operation'
