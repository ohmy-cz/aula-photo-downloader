import type { Capture } from '../types'
import { Temporal } from '@js-temporal/polyfill'
import { CONFIG } from '../config'
import { validDay } from '../security'

/** Resolve repeated wall times to the later occurrence; reject spring clock gaps. */
const wallTime = (day: string, time: string): Temporal.ZonedDateTime => {
  const local = Temporal.PlainDateTime.from(`${day}T${time}`)

  const zoned = local.toZonedDateTime(CONFIG.archive.timeZone, {
    disambiguation: 'later',
  })

  if (!zoned.toPlainDateTime().equals(local)) {
    throw new Error('Invalid archive local time.')
  }

  return zoned
}

/** Project one resolved instant into the persisted metadata plan without trusting separately supplied offsets. */
const fromZoned = (
  zoned: Temporal.ZonedDateTime,
  basis: Capture['basis'],
): Capture => ({
  day: zoned.toPlainDate().toString(),
  time: zoned.toPlainTime().toString({ smallestUnit: 'second' }),
  offset: zoned.offset,
  utc: zoned
    .toInstant()
    .toString({ smallestUnit: 'second' })
    .slice(0, 19)
    .replace('T', ' ')
    .replace(/-/g, ':'),
  basis,
})

/** Return YYYY-MM-DD in the archive timezone, including daylight-saving changes. */
export const archiveZoneDay = (instant = new Date()): string =>
  Temporal.Instant.fromEpochMilliseconds(instant.getTime())
    .toZonedDateTimeISO(CONFIG.archive.timeZone)
    .toPlainDate()
    .toString()

/** Resolve an archive-timezone offset, rejecting spring gaps and choosing the later autumn occurrence. */
export const offsetFor = (day: string, time: string): string =>
  wallTime(day, time).offset

/** Prefer exact camera filenames; otherwise assign ordered seconds near noon on the upload day. */
export const captureFor = (
  filename: string,
  day: string | null,
  position: number,
  order: 'asc' | 'desc',
): Capture | null => {
  const match
    = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})(?:\.(?:jpe?g|png|hei[cf]|tiff?|mp4|mov|mkv|webm))?$/i.exec(
      filename,
    )

  if (match) {
    const [, y, m, d, h, min, s] = match

    const date = `${String(y)}-${String(m)}-${String(d)}`

    const time = `${String(h)}:${String(min)}:${String(s)}`

    if (
      validDay(date)
      && Number(h) < 24
      && Number(min) < 60
      && Number(s) < 60
    ) {
      try {
        return captureAt(date, time, 'filename')
      }
      catch {
        /* Use the upload day for clock gaps. */
      }
    }
  }

  if (!validDay(day)) {
    return null
  }

  // Saturate very large galleries at the day boundary; the current run keeps its plan.
  const seconds
    = CONFIG.archive.uploadSequenceStartSeconds
      + (order === 'asc' ? position - 1 : 1 - position)

  if (!Number.isSafeInteger(seconds)) {
    return null
  }

  const noon = wallTime(day, '12:00:00')

  const first = Temporal.PlainDate.from(day).toZonedDateTime(
    CONFIG.archive.timeZone,
  )

  const last = first.add({ days: 1 }).subtract({ seconds: 1 })

  // Clamp before converting: huge galleries still saturate at the day's boundary.
  const milliseconds = Math.max(
    first.epochMilliseconds,
    Math.min(
      last.epochMilliseconds,
      noon.epochMilliseconds
      + (seconds - CONFIG.archive.uploadSequenceStartSeconds) * 1000,
    ),
  )

  return fromZoned(
    Temporal.Instant.fromEpochMilliseconds(milliseconds).toZonedDateTimeISO(
      CONFIG.archive.timeZone,
    ),
    'upload-sequence',
  )
}

/**
 * Resolve archive wall time into matching local, offset, and UTC metadata fields.
 * @throws If the date/time is invalid or falls in a spring clock gap.
 */
export const captureAt = (
  day: string,
  time: string,
  basis: Capture['basis'],
): Capture => {
  if (!validDay(day) || !/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(time)) {
    throw new Error('Invalid capture time.')
  }

  return fromZoned(wallTime(day, time), basis)
}

/** Format archive wall time for ExifTool; its timezone offset is written separately. */
export const stamp = (capture: Capture): string =>
  `${capture.day.replace(/-/g, ':')} ${capture.time}`
