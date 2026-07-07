import { readFile } from 'fs/promises'
import { PDFParse } from 'pdf-parse'

async function test() {
  const p = process.argv[2]
  console.log('Reading', p)
  const buf = await readFile(p)
  console.log('Read', buf.length)
  const instance = new PDFParse({ verbosity: 0 })
  console.log('Loading instance')
  await instance.load(new Uint8Array(buf))
  console.log('Loaded')
  const text = await instance.getText()
  console.log('Text length:', text.length)
  instance.destroy()
}

test().catch(console.error)
