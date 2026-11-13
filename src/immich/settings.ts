import type { ConnectionStatus, ImmichConnection, ImmichDestination } from './contracts'
import { CONFIG } from '../config'
import { AppError } from '../errors'
import { Connection, immichPermission } from './contracts'

/** Read credentials only in trusted extension contexts; invalid settings reset without migration. */
export const loadConnection = async (): Promise<ImmichConnection | null> => {
  const value = (await chrome.storage.local.get(CONFIG.immich.storageKey))[CONFIG.immich.storageKey]

  try {
    const parsed = Connection.safeParse(value)

    if (parsed.success) {
      return parsed.data
    }
  }
  catch {
    // Invalid URL refinements reject the same settings as a failed schema check.
  }

  if (value !== undefined) {
    await chrome.storage.local.remove(CONFIG.immich.storageKey)
  }

  return null
}

/** Require the user's optional host grant as well as a saved connection, including after permissions are revoked. */
export const connected = async (connection: ImmichConnection | null): Promise<boolean> =>
  connection !== null && await chrome.permissions.contains({ origins: [immichPermission(connection.server)] })

/** Expose connection state and key length for masking, never the saved key, to the options page. */
export const connectionStatus = async (): Promise<ConnectionStatus> => {
  const connection = await loadConnection()

  return { connected: await connected(connection), server: connection?.server ?? '', keyLength: connection?.apiKey.length ?? 0 }
}

/** Bind work to the verified connection selected at submission; a replaced connection cannot silently receive an old run. */
export const requireConnection = async (destination?: Pick<ImmichDestination, 'connectionId'>): Promise<ImmichConnection> => {
  const connection = await loadConnection()

  if (!connection || !await connected(connection) || (destination && destination.connectionId !== connection.id)) {
    throw new AppError('immich-config')
  }

  return connection
}

/** Store credentials locally, outside sync storage and content-script access. */
export const saveConnection = async (connection: ImmichConnection): Promise<void> => {
  await chrome.storage.local.set({ [CONFIG.immich.storageKey]: Connection.parse(connection) })
}

/** Keep download checkpoints independent of each Immich connection and destination album. */
export const destinationKey = async (gallery: string, destination: ImmichDestination | null): Promise<string> => {
  if (!destination) {
    return gallery
  }

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([gallery, destination.connectionId, destination.albumId])))

  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
