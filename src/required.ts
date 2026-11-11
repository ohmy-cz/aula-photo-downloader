/** Fail at a missing required value instead of allowing an unchecked assertion to leak undefined. */
export const required = <T>(value: T | null | undefined): T => {
  if (value === undefined || value === null) {
    throw new Error('A required value is missing.')
  }

  return value
}
