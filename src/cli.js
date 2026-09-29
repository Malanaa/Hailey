import { readFile, writeFile, mkdir, open } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { compile } from './index.js'
import { Runtime } from './runtime.js'
import { fail } from './errors.js'

const VERSION = '0.1.0'
const help = `Hailey ${VERSION}
A small language for inspectable AI workflows.

Usage
  hailey init [directory]       Create an offline starter project
  hailey check <file>           Check declarations and references without running
  hailey run <file>             Execute the main flow
  hailey test <file>            Execute every test block
  hailey inspect <trace>        Print a saved trace as JSON
  hailey version               Print the installed version

Run options
  --flow <name>                Choose a flow, default main
  --input <name=value>         Pass a String input, repeatable
  --max-calls <count>          Maximum model attempts, default 20
  --trace <file>               Save prompts, responses, and local reads
  --replay <file>              Replay a matching recording without network calls
  --allow-read <directory>     Allow read_text under this directory, repeatable

Test options
  --live                       Allow live models, which can incur charges
  --max-calls <count>          Maximum model attempts per test, default 20
  --input <name=value>         Pass a String input, repeatable
  --allow-read <directory>     Grant file access, repeatable

Requires Node.js 22 or later. Documentation: https://malanaa.github.io/Hailey/`

function options(args, command) {
  const opts = { inputs: Object.create(null), allowRead: [] }
  const allowed = command === 'run' ? ['flow', 'input', 'max-calls', 'trace', 'replay', 'allow-read'] : ['live', 'max-calls', 'input', 'allow-read']
  const seen = new Set()
  for (let i = 0; i < args.length; i += 1) {
    const key = args[i].replace(/^--/, '')
    if (!args[i].startsWith('--') || !allowed.includes(key)) fail('CLI', `Unknown option ${args[i]}`)
    if (seen.has(key) && !['input', 'allow-read'].includes(key)) fail('CLI', `Duplicate option --${key}`)
    seen.add(key)
    if (key === 'live') { opts.live = true
      continue
    }
    const value = args[++i]
    if (value === undefined || value.startsWith('--')) fail('CLI', `Missing value for --${key}`)
    if (key === 'input') {
      const split = value.indexOf('=')
      if (split < 1) fail('CLI', '--input must be name=value')
      const name = value.slice(0, split)
      if (Object.hasOwn(opts.inputs, name)) fail('CLI', `Duplicate input ${name}`)
      opts.inputs[name] = value.slice(split + 1)
    } else if (key === 'allow-read') opts.allowRead.push(value)
    else if (key === 'max-calls') {
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) fail('CLI', '--max-calls must be a nonnegative integer')
      opts.maxCalls = Number(value)
    } else opts[key] = value
  }
  return opts
}

export async function main(args) {
  let runtime
  let traceHandle
  try {
    const [command, file, ...rest] = args
    if (!command || ['help', '--help', '-h'].includes(command)) { console.log(help)
      return
    }
    if (['version', '--version', '-v'].includes(command)) { console.log(VERSION)
      return
    }
    if (command === 'init') {
      if (rest.length) fail('CLI', 'Usage: hailey init [directory]')
      const directory = resolve(file || '.')
      await mkdir(directory, { recursive: true })
      const source = await readFile(new URL('../examples/triage.hailey', import.meta.url), 'utf8')
      await writeFile(resolve(directory, 'main.hailey'), source, { flag: 'wx' })
      console.log(`Created ${resolve(directory, 'main.hailey')}\nRun: hailey run "${resolve(directory, 'main.hailey')}"`)
      return
    }
    if (!['check', 'run', 'test', 'inspect'].includes(command)) fail('CLI', `Unknown command ${command}. Run hailey --help`)
    if (!file || file.startsWith('--')) fail('CLI', `${command} requires a file`)
    if (['check', 'inspect'].includes(command) && rest.length) fail('CLI', `${command} does not accept options`)
    const source = await readFile(file, 'utf8')
    if (command === 'inspect') {
      const trace = JSON.parse(source)
      if (trace.version !== 1 || !Array.isArray(trace.events)) fail('TRACE', 'Not a Hailey v1 trace')
      console.log(JSON.stringify(trace, null, 2))
      return
    }
    const program = compile(source)
    if (command === 'check') {
      console.log(`Checked ${file}: ${program.tasks.size} tasks, ${program.flows.size} flows, ${program.tests.size} tests`)
      return
    }
    const opts = options(rest, command)
    opts.baseDir = dirname(resolve(file))
    opts.onPrint = text => console.log(text)
    if (command === 'test') {
      if (!program.tests.size) fail('CHECK', 'No test blocks found')
      if (!opts.live && [...program.models.values()].some(model => model.config.provider !== 'mock')) fail('CONFIG', 'This file declares a live model. Use --live to enable paid test calls')
      let failures = 0
      for (const [name] of program.tests) {
        try {
          const test = new Runtime(program, opts)
          await test.run(name, 'test')
          console.log(`PASS ${name}`)
        } catch (error) {
          failures += 1
          console.error(`FAIL ${name}: [${error.code || 'RUNTIME'}] ${error.message}`)
        }
      }
      console.log(`${program.tests.size - failures}/${program.tests.size} tests passed`)
      if (failures) process.exitCode = 1
      return
    }
    if (opts.replay) opts.replay = JSON.parse(await readFile(opts.replay, 'utf8'))
    runtime = new Runtime(program, opts)
    // Refuse to overwrite any existing file, including source files and symlinks.
    if (opts.trace) traceHandle = await open(opts.trace, 'wx', 0o600)
    await runtime.run(opts.flow || 'main')
    const events = runtime.trace.events.filter(event => event.kind === 'model')
    const known = events.filter(event => event.estimatedCostUSD !== null)
    const sum = known.reduce((total, event) => total + event.estimatedCostUSD, 0)
    const cost = known.length === events.length ? `$${sum.toFixed(6)} estimated` : `$${sum.toFixed(6)} known estimate, ${events.length - known.length} unpriced attempts`
    console.error(`${opts.replay ? 'Replayed' : 'Completed'}: ${events.length} model attempts, ${cost}${opts.replay ? ' (recorded cost, no new inference)' : ''}`)
  } catch (error) {
    const location = error.location ? `:${error.location.line}:${error.location.column}` : ''
    console.error(`hailey${location} [${error.code || 'IO'}] ${error.message}`)
    process.exitCode = 1
  } finally {
    if (traceHandle) {
      try { await traceHandle.writeFile(`${JSON.stringify(runtime.trace, null, 2)}\n`) }
      catch (error) { console.error(`hailey [TRACE] Cannot save trace: ${error.message}`)
        process.exitCode = 1
      } finally { await traceHandle.close() }
    }
  }
}
