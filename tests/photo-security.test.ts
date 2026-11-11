import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readdir, readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { crc32, deflateSync } from 'node:zlib'
import { dispose } from '@colorhythm/exiftool-wasm'
import { parseMedia } from '../src/api'
import { CONFIG } from '../src/config'
import { processBytes } from '../src/metadata/processor'
import { required } from '../src/required'
import fixture from './fixtures/aula/gallery-v25.json'

/** Generate compressed metadata in the synthetic PNG; no downloaded or captured fixture is stored. */
const pngWithText = async (text: string, xmp = false) => {
  const source = await readFile('tests/fixtures/sample.png')

  const type = Buffer.from(xmp ? 'iTXt' : 'zTXt')

  const data = Buffer.concat([
    Buffer.from(xmp ? 'XML:com.adobe.xmp\0\x01\0\0\0' : 'Description\0\0'),
    deflateSync(text),
  ])

  const length = Buffer.alloc(4)

  length.writeUInt32BE(data.length)

  const checksum = Buffer.alloc(4)

  checksum.writeUInt32BE(crc32(Buffer.concat([type, data])))

  return Buffer.concat([source.subarray(0, -12), length, type, data, checksum, source.subarray(-12)])
}

/** Exercise the actual pinned parser before a build exists; runtime heap enforcement is checked by test:wasm. */
const fetchWasm: typeof fetch = async () => {
  const directory = new URL('../node_modules/@colorhythm/exiftool-wasm/dist/esm/', import.meta.url)

  const name = required((await readdir(directory)).find(name => name.endsWith('.wasm')))

  return new Response(new Uint8Array(await readFile(new URL(name, directory))))
}

const photo = { ...parseMedia(required(fixture.data.results[0]), 1, 'desc'), filename: '20260430_095302.png' }

void test('Compressed unrelated photo metadata is excluded from extraction without blocking the photo', async () => {
  try {
    const source = await pngWithText('Synthetic description. '.repeat(200000))

    assert(source.byteLength < CONFIG.limits.metadataBytes)

    const result = await processBytes(photo, source, fetchWasm)

    assert.equal(result.mime, 'image/png')

    assert(result.bytes.byteLength > 0)
  }
  finally {
    await dispose()
  }
})

void test('Compressed required photo metadata exceeding the budget rejects the file before writing', async () => {
  try {
    const subject = 'Synthetic subject. '.repeat(70000)

    const source = await pngWithText(`<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:subject><rdf:Bag><rdf:li>${subject}</rdf:li></rdf:Bag></dc:subject></rdf:Description></rdf:RDF></x:xmpmeta>`, true)

    assert(source.byteLength < CONFIG.limits.metadataBytes)

    await assert.rejects(processBytes(photo, source, fetchWasm), /metadata exceeds the processing limit/)
  }
  finally {
    await dispose()
  }
})
