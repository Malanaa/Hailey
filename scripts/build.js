import { mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

await mkdir('dist', { recursive: true })
const npmCli = process.env.npm_execpath
if (!npmCli) throw new Error('Run this script with npm run build')
execFileSync(process.execPath, [npmCli, 'pack', '--pack-destination', 'dist'], { stdio: 'inherit' })
const file = 'hailey-lang-0.1.0.tgz'
const digest = createHash('sha256').update(readFileSync(`dist/${file}`)).digest('hex')
await writeFile('dist/SHA256SUMS.txt', `${digest}  ${file}\n`)
console.log(`Built dist/${file}`)
