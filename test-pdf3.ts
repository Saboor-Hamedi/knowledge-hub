import fs from 'fs/promises'
import { PDFParse } from 'pdf-parse'

async function run() {
  const data = await fs.readFile('package.json') // still not a pdf but we'll see if the error changes
  const instance = new PDFParse({ verbosity: 0 })
  try {
      await instance.load({ data: new Uint8Array(data) })
      console.log('Loaded successfully')
  } catch(e) {
      console.log('Error parsing:', e.message)
  }
}
run()
