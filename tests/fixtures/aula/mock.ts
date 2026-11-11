import fixture from './gallery-v25.json'

/** Build synthetic pages from the sanitized observed envelope, never from the production adapter. */
export const wireJSON = (value: unknown): string => {
  const input = value as { data?: object }

  return JSON.stringify({ ...fixture, ...input, data: { ...fixture.data, startIndex: 0, album: null, ...input.data } })
}
