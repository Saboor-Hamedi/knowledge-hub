import fs from 'fs/promises'
import pdfParse from 'pdf-parse'
import { extname } from 'path'

async function run() {
  console.log('pdfParse:', typeof pdfParse, pdfParse)
  
  if (typeof pdfParse === 'function') {
      const data = await fs.readFile('package.json') // using a random file just to see if it starts parsing
      try {
          await pdfParse(data)
      } catch(e) {
          console.log('Error parsing:', e.message)
      }
  } else {
      console.log('Not a function', pdfParse)
  }
}
run()
