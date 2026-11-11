import { sleep } from '../async'
import { CONFIG } from '../config'

/** Space downloads after this extension's confirmed Chrome completions, including across worker restarts. */
export const download = async (
  url: string,
  filename: string,
): Promise<number> => {
  const recent = await chrome.downloads.search({
    state: 'complete',
    endedAfter: new Date(
      Date.now() - CONFIG.timing.downloadGapMs,
    ).toISOString(),
    limit: 0,
  })

  const completed = recent.reduce(
    (latest, item) =>
      item.byExtensionId === chrome.runtime.id
        ? Math.max(latest, Date.parse(item.endTime ?? '') || 0)
        : latest,
    0,
  )

  const remaining = completed + CONFIG.timing.downloadGapMs - Date.now()

  if (remaining > 0) {
    await sleep(remaining)
  }

  return chrome.downloads.download({
    url,
    filename,
    conflictAction: 'uniquify',
    saveAs: false,
  })
}
