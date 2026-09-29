export { parse, tokenize } from './parser.js'
export { check, schemaFor, validate } from './checker.js'
export { Runtime } from './runtime.js'
export { HaileyError } from './errors.js'
import { parse } from './parser.js'
import { check } from './checker.js'
import { Runtime } from './runtime.js'

export function compile(source) {
  return check(parse(source))
}

export async function run(source, options = {}) {
  const runtime = new Runtime(compile(source), options)
  return runtime.run(options.flow || 'main')
}
