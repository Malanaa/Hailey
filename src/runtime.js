import { createHash } from 'node:crypto'
import { realpath, readFile, stat } from 'node:fs/promises'
import { resolve, relative, isAbsolute } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { fail, HaileyError } from './errors.js'
import { validate } from './checker.js'
import { complete } from './provider.js'

export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
const printable = value => typeof value === 'string' ? value : JSON.stringify(value, null, 2)
const boolean = value => { if (typeof value !== 'boolean') fail('TYPE', 'Conditions must be Bool values')
  return value
}

export class Runtime {
  constructor(program, options = {}) {
    this.program = program
    this.options = options
    this.maxCalls = options.maxCalls ?? 20
    if (!Number.isSafeInteger(this.maxCalls) || this.maxCalls < 0) fail('CONFIG', 'maxCalls must be a nonnegative integer')
    this.calls = 0
    this.cursor = 0
    this.outputs = []
    this.trace = { version: 1, sourceHash: hash(program.source), events: [], outputs: this.outputs, status: 'running' }
    if (options.replay && (options.replay.version !== 1 || options.replay.sourceHash !== this.trace.sourceHash || !Array.isArray(options.replay.events))) fail('REPLAY', 'Trace version or source does not match this program')
  }
  replayEvent(kind, request) {
    const event = this.options.replay.events[this.cursor++]
    if (!event || event.kind !== kind || event.requestHash !== hash(request)) fail('REPLAY', `Recorded ${kind} request does not match at event ${this.cursor}`)
    const copy = structuredClone(event)
    copy.replayed = true
    this.trace.events.push(copy)
    return copy
  }
  async readText(path) {
    if (typeof path !== 'string') fail('TYPE', 'read_text expects a String path')
    const request = { path }
    if (this.options.replay) {
      const event = this.replayEvent('read', request)
      if (typeof event.content !== 'string') fail('REPLAY', 'Recorded file content is invalid')
      return event.content
    }
    if (!this.options.allowRead?.length) fail('CAPABILITY', 'read_text requires --allow-read with an explicit directory')
    const target = await realpath(resolve(this.options.baseDir || '.', path))
    const roots = await Promise.all(this.options.allowRead.map(root => realpath(resolve(root))))
    if (!roots.some(root => {
      const rel = relative(root, target)
      return rel === '' || (rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(rel))
    })) fail('CAPABILITY', 'File is outside the allowed read directories')
    const info = await stat(target)
    if (!info.isFile() || info.size > 1024 * 1024) fail('CAPABILITY', 'read_text requires a regular file no larger than 1 MiB')
    const content = await readFile(target, 'utf8')
    this.trace.events.push({ kind: 'read', requestHash: hash(request), path, content })
    return content
  }
  interpolate(template, params) {
    return template.replace(/\{\{([^{}]+)\}\}/g, (_, path) => {
      const parts = path.trim().split('.')
      let value = params[parts.shift()]
      for (const field of parts) {
        if (value === null || typeof value !== 'object' || !Object.hasOwn(value, field)) fail('TYPE', `Missing prompt field ${path}`)
        value = value[field]
      }
      return typeof value === 'string' ? value : JSON.stringify(value)
    })
  }
  async call(name, args) {
    const task = this.program.tasks.get(name)
    if (!task) fail('CHECK', `Unknown task ${name}`)
    if (args.length !== task.params.length) fail('TYPE', `${name} expects ${task.params.length} arguments`)
    const params = Object.fromEntries(task.params.map((param, i) => [param.name, validate(args[i], param.schema, `${name}.${param.name}`)]))
    const model = this.program.models.get(task.model).config
    const context = task.context.map(id => ({ name: id, text: this.program.contexts.get(id).text }))
    const system = this.interpolate(task.system, params)
    const prompt = this.interpolate(task.prompt, params)
    const messages = [
      { role: 'system', content: `${system}\nReturn only JSON matching this schema:\n${JSON.stringify(task.wireSchema)}` },
      ...context.map(item => ({ role: 'user', content: `Context (${item.name}):\n${item.text}` })),
      { role: 'user', content: prompt }
    ]
    const request = { task: name, model, messages, schema: task.wireSchema }
    let attempt = 0
    while (attempt <= task.retries) {
      if (this.calls >= this.maxCalls) fail('BUDGET', `Model call limit of ${this.maxCalls} reached`)
      this.calls += 1
      attempt += 1
      let event
      if (this.options.replay) {
        event = this.replayEvent('model', request)
      } else {
        event = { kind: 'model', task: name, attempt, requestHash: hash(request), model: task.model, provider: model.provider, messages, context: task.context, schema: task.schema, usage: null, estimatedCostUSD: null }
        this.trace.events.push(event)
        const start = Date.now()
        try {
          if (model.provider === 'mock') {
            event.value = structuredClone(task.mock)
            event.estimatedCostUSD = 0
          } else {
            const response = await complete(model, request, this.options)
            event.usage = response.usage
            event.raw = response.content
            let parsed
            try { parsed = JSON.parse(response.content) } catch { fail('TYPE', 'Model output was not valid JSON') }
            validate(parsed, task.wireSchema)
            event.value = parsed.result
          }
          validate(event.value, task.schema)
        } catch (error) {
          event.error = { code: error.code || 'RUNTIME', message: error.message, retryable: Boolean(error.retryable || error.code === 'TYPE') }
          event.usage ??= error.usage || null
        }
        if (model.provider !== 'mock' && event.usage && model.input_price !== undefined) {
          event.estimatedCostUSD = (event.usage.inputTokens * model.input_price + event.usage.outputTokens * model.output_price) / 1000000
        }
        event.durationMs = Date.now() - start
      }
      if (event.error) {
        if (event.error.retryable && attempt <= task.retries) {
          if (!this.options.replay) await new Promise(done => setTimeout(done, Math.min(250 * 2 ** (attempt - 1), 4000)))
          continue
        }
        throw new HaileyError(event.error.code, event.error.message)
      }
      return validate(event.value, task.schema)
    }
  }
  async expression(expr, scope) {
    if (expr.kind === 'literal') return expr.value
    if (expr.kind === 'variable') {
      if (!scope.has(expr.name)) fail('RUNTIME', `Unknown variable ${expr.name}`, expr.location)
      return scope.get(expr.name)
    }
    if (expr.kind === 'array') {
      const values = []
      for (const item of expr.items) values.push(await this.expression(item, scope))
      return values
    }
    if (expr.kind === 'object') {
      const entries = []
      for (const [key, value] of expr.entries) entries.push([key, await this.expression(value, scope)])
      return Object.fromEntries(entries)
    }
    if (expr.kind === 'field') {
      const value = await this.expression(expr.object, scope)
      if (!value || typeof value !== 'object' || !Object.hasOwn(value, expr.field)) fail('TYPE', `No field ${expr.field}`, expr.location)
      return value[expr.field]
    }
    if (expr.kind === 'not') return !boolean(await this.expression(expr.value, scope))
    if (expr.kind === 'binary') {
      const left = await this.expression(expr.left, scope)
      if (expr.op === '&&') return boolean(left) && boolean(await this.expression(expr.right, scope))
      if (expr.op === '||') return boolean(left) || boolean(await this.expression(expr.right, scope))
      const right = await this.expression(expr.right, scope)
      if (expr.op === '==') return isDeepStrictEqual(left, right)
      if (expr.op === '!=') return !isDeepStrictEqual(left, right)
      if (typeof left !== 'number' || typeof right !== 'number') fail('TYPE', 'Ordering comparisons require numbers', expr.location)
      if (expr.op === '<') return left < right
      if (expr.op === '>') return left > right
      if (expr.op === '<=') return left <= right
      if (expr.op === '>=') return left >= right
    }
    if (expr.kind === 'call') {
      const args = []
      for (const arg of expr.args) args.push(await this.expression(arg, scope))
      if (expr.name === 'input') {
        if (typeof args[0] !== 'string') fail('TYPE', 'input expects a String name')
        if (!Object.hasOwn(this.options.inputs || {}, args[0])) fail('INPUT', `Missing input ${args[0]}, pass --input ${args[0]}=value`)
        return this.options.inputs[args[0]]
      }
      if (expr.name === 'read_text') return this.readText(args[0])
      return this.call(expr.name, args)
    }
    fail('RUNTIME', `Unknown expression ${expr.kind}`)
  }
  async statements(body, parent = new Map()) {
    const scope = new Map(parent)
    for (const stmt of body) {
      try {
        if (stmt.kind === 'let') scope.set(stmt.name, await this.expression(stmt.value, scope))
        if (stmt.kind === 'print') {
          const output = await this.expression(stmt.value, scope)
          this.outputs.push(output)
          this.options.onPrint?.(printable(output))
        }
        if (stmt.kind === 'assert' && !boolean(await this.expression(stmt.value, scope))) fail('ASSERT', 'Assertion failed', stmt.location)
        if (stmt.kind === 'if') await this.statements(boolean(await this.expression(stmt.condition, scope)) ? stmt.yes : stmt.no, scope)
      } catch (error) {
        error.location ??= stmt.location
        throw error
      }
    }
  }
  async run(name = 'main', kind = 'flow') {
    this.trace.entry = { kind, name }
    if (this.options.replay && (this.options.replay.entry?.kind !== kind || this.options.replay.entry?.name !== name)) fail('REPLAY', 'Trace entry point does not match')
    try {
      const entry = (kind === 'test' ? this.program.tests : this.program.flows).get(name)
      if (!entry) fail('CHECK', `Unknown ${kind} ${name}`)
      await this.statements(entry.body)
      if (this.options.replay && this.cursor !== this.options.replay.events.length) fail('REPLAY', 'Trace contains unconsumed events')
      if (this.options.replay && !isDeepStrictEqual(this.outputs, this.options.replay.outputs)) fail('REPLAY', 'Program output differs from the recording')
      this.trace.status = 'ok'
      return this.trace
    } catch (error) {
      this.trace.status = 'error'
      this.trace.error = { code: error.code || 'RUNTIME', message: error.message }
      throw error
    }
  }
}
