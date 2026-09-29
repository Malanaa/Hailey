import { readFile, readdir, access } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { compile } from '../src/index.js'

const decode = text => text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&#x27;', "'").replaceAll('&amp;', '&')
const pages = (await readdir('docs')).filter(name => name.endsWith('.html'))
let links = 0
let examples = 0
for (const page of pages) {
  const path = resolve('docs', page)
  const html = await readFile(path, 'utf8')
  if (html.includes('—')) throw new Error(`Em dash in ${page}`)
  if (!html.includes('cdn.jsdelivr.net/npm/@tailwindcss/browser@4')) throw new Error(`Missing Tailwind CDN in ${page}`)
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1])
  if (new Set(ids).size !== ids.length) throw new Error(`Duplicate HTML id in ${page}`)
  for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const url = match[1]
    if (/^(https?:|mailto:)/.test(url)) continue
    const [file, anchor] = url.split('#')
    const target = file ? resolve(dirname(path), file) : path
    await access(target)
    if (anchor) {
      const text = target === path ? html : await readFile(target, 'utf8')
      if (!text.includes(`id="${anchor}"`)) throw new Error(`Broken anchor ${url} in ${page}`)
    }
    links += 1
  }
  for (const match of html.matchAll(/<pre data-example="([^"]+)"><code>([\s\S]*?)<\/code><\/pre>/g)) {
    const source = await readFile(match[1], 'utf8')
    if (decode(match[2]).trim() !== source.trim()) throw new Error(`Stale example ${match[1]} in ${page}`)
    compile(source)
    examples += 1
  }
  for (const match of html.matchAll(/<pre><code>([\s\S]*?)<\/code><\/pre>/g)) {
    const text = decode(match[1])
    if (/^(type |model |flow |\/\/ A line comment)/.test(text) && text.includes('flow main')) compile(text)
  }
}
for (const name of (await readdir('examples')).filter(name => name.endsWith('.hailey'))) compile(await readFile(`examples/${name}`, 'utf8'))
console.log(`Checked ${pages.length} pages, ${links} local links, and ${examples} synchronized examples`)
