import settings from '../config.json'

/** Build-time settings shared by runtime code, generated permissions, and processing. */
export const CONFIG = settings

export const ROOT_FOLDER = CONFIG.archive.rootFolder

export const STORAGE_KEY = CONFIG.archive.storageKey

/** Construct the default read-only gallery request from the central Aula settings. */
export const defaultGalleryUrl = (): string => {
  const url = new URL(
    `/api/v${String(CONFIG.aula.apiVersion)}/`,
    CONFIG.aula.origin,
  )

  url.search = new URLSearchParams({
    method: CONFIG.aula.mediaMethod,
    userSpecificAlbum: 'true',
    sortOn: CONFIG.aula.defaultSort,
    orderDirection: CONFIG.aula.defaultOrder,
    filterBy: CONFIG.aula.defaultFilter,
  }).toString()

  return url.href
}
