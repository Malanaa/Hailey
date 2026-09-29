import { fail } from './errors.js'

const primitives = { String: 'string', Number: 'number', Int: 'integer', Bool: 'boolean' }
export function schemaFor(type, program, seen = []) {
  if (type.kind === 'enum') return { type: 'string', enum: type.values }
  if (type.kind === 'array') return { type: 'array', items: schemaFor(type.item, program, seen) }
  if (type.kind === 'nullable') return { anyOf: [schemaFor(type.item, program, seen), { type: 'null' }] }
  if (Object.hasOwn(primitives, type.name)) return { type: primitives[type.name] }
  if (!program.types.has(type.name)) fail('CHECK', `Unknown type ${type.name}`)
  if (seen.includes(type.name)) fail('CHECK', `Recursive type ${type.name} is not supported in v0.1`)
  const fields = program.types.get(type.name).fields
  return {
    type: 'object', additionalProperties: false,
    required: Object.keys(fields),
    properties: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, schemaFor(value, program, [...seen, type.name])]))
  }
}

export function validate(value, schema, path = 'result') {
  if (schema.anyOf) {
    if (!schema.anyOf.some(item => { try { validate(value, item, path)
      return true
    } catch { return false } })) fail('TYPE', `${path} does not match its declared type`)
    return value
  }
  const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
  if (schema.type === 'integer' ? !Number.isSafeInteger(value) : actual !== schema.type) fail('TYPE', `${path} expected ${schema.type}, received ${actual}`)
  if (typeof value === 'number' && !Number.isFinite(value)) fail('TYPE', `${path} must be finite`)
  if (schema.enum && !schema.enum.includes(value)) fail('TYPE', `${path} must be one of ${schema.enum.map(v => JSON.stringify(v)).join(', ')}`)
  if (schema.type === 'object') {
    for (const key of schema.required) {
      if (!Object.hasOwn(value, key)) fail('TYPE', `${path}.${key} is required`)
      validate(value[key], schema.properties[key], `${path}.${key}`)
    }
    for (const key of Object.keys(value)) if (!Object.hasOwn(schema.properties, key)) fail('TYPE', `${path}.${key} is not a declared field`)
  }
  if (schema.type === 'array') value.forEach((v, i) => validate(v, schema.items, `${path}[${i}]`))
  return value
}

export function literal(expr) {
  if (expr.kind === 'literal') return expr.value
  if (expr.kind === 'array') return expr.items.map(literal)
  if (expr.kind === 'object') return Object.fromEntries(expr.entries.map(([key, value]) => [key, literal(value)]))
  fail('CHECK', 'Expected a constant value', expr.location)
}

const propertySet = (props, allowed, location) => {
  for (const key of Object.keys(props)) if (!allowed.includes(key)) fail('CHECK', `Unknown property ${key}`, location)
}
const constant = (props, key, fallback) => props[key] ? literal(props[key]) : fallback
const positive = (value, key) => {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647) fail('CHECK', `${key} must be a positive 32-bit integer`)
}
const string = (value, key) => { if (typeof value !== 'string' || !value.trim()) fail('CHECK', `${key} must be a nonempty string`) }

export function check(program) {
  for (const name of program.types.keys()) schemaFor({ kind: 'ref', name }, program)
  for (const [name, model] of program.models) {
    const p = model.props
    propertySet(p, ['provider', 'name', 'endpoint', 'api_key', 'max_output_tokens', 'timeout_ms', 'input_price', 'output_price', 'format', 'token_parameter'], model.location)
    const config = Object.fromEntries(Object.entries(p).map(([key, value]) => [key, literal(value)]))
    config.provider ??= 'mock'
    if (!['mock', 'compatible'].includes(config.provider)) fail('CHECK', `Model ${name} provider must be mock or compatible`)
    config.max_output_tokens ??= 512
    config.timeout_ms ??= 30000
    config.format ??= 'json_schema'
    config.token_parameter ??= 'max_completion_tokens'
    positive(config.max_output_tokens, 'max_output_tokens')
    positive(config.timeout_ms, 'timeout_ms')
    if (!['json_schema', 'json_object'].includes(config.format)) fail('CHECK', 'format must be json_schema or json_object')
    if (!['max_completion_tokens', 'max_tokens'].includes(config.token_parameter)) fail('CHECK', 'token_parameter must be max_completion_tokens or max_tokens')
    if ((config.input_price === undefined) !== (config.output_price === undefined)) fail('CHECK', 'Set both input_price and output_price, or neither')
    for (const key of ['input_price', 'output_price']) {
      if (config[key] !== undefined && (typeof config[key] !== 'number' || config[key] < 0 || !Number.isFinite(config[key]))) fail('CHECK', `${key} must be a nonnegative number`)
    }
    if (config.provider === 'compatible') {
      string(config.name, 'name')
      string(config.endpoint, 'endpoint')
      let url
      try { url = new URL(config.endpoint) } catch { fail('CHECK', 'endpoint must be an absolute URL') }
      if (url.username || url.password || url.search || url.hash) fail('CHECK', 'endpoint cannot contain credentials, query parameters, or a fragment')
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) fail('CHECK', 'Use HTTPS, or HTTP on localhost')
      if (config.api_key !== undefined && (typeof config.api_key !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(config.api_key))) fail('CHECK', 'api_key must name an environment variable')
    }
    model.config = config
  }
  for (const context of program.contexts.values()) {
    propertySet(context.props, ['text'], context.location)
    context.text = constant(context.props, 'text')
    string(context.text, 'context text')
  }
  for (const [name, task] of program.tasks) {
    propertySet(task.props, ['model', 'system', 'prompt', 'context', 'retries', 'mock'], task.location)
    const model = task.props.model
    if (model?.kind !== 'variable' || !program.models.has(model.name)) fail('CHECK', `Task ${name} must reference a declared model`, task.location)
    task.model = model.name
    task.system = constant(task.props, 'system', 'Return accurate JSON matching the requested schema.')
    task.prompt = constant(task.props, 'prompt')
    string(task.system, 'system')
    string(task.prompt, 'prompt')
    task.retries = constant(task.props, 'retries', 0)
    if (!Number.isInteger(task.retries) || task.retries < 0 || task.retries > 5) fail('CHECK', 'retries must be an integer from 0 to 5')
    task.context = []
    if (task.props.context) {
      if (task.props.context.kind !== 'array') fail('CHECK', 'context must be a list of context names')
      task.context = task.props.context.items.map(expr => {
        if (expr.kind !== 'variable' || !program.contexts.has(expr.name)) fail('CHECK', 'Unknown context reference', expr.location)
        return expr.name
      })
    }
    task.schema = schemaFor(task.returns, program)
    // All providers receive an object wrapper, including primitive return types.
    task.wireSchema = { type: 'object', properties: { result: task.schema }, required: ['result'], additionalProperties: false }
    task.params.forEach(p => { p.schema = schemaFor(p.type, program) })
    for (const template of [task.prompt, task.system]) {
      for (const match of template.matchAll(/\{\{([^{}]+)\}\}/g)) {
        const parts = match[1].trim().split('.')
        const param = task.params.find(p => p.name === parts[0])
        if (!param) fail('CHECK', `Unknown prompt parameter ${parts[0]}`, task.location)
        let schema = param.schema
        for (const field of parts.slice(1)) {
          if (schema.type !== 'object' || !Object.hasOwn(schema.properties, field)) fail('CHECK', `Unknown or nullable prompt field ${match[1]}`, task.location)
          schema = schema.properties[field]
        }
      }
    }
    if (task.props.mock) { task.mock = literal(task.props.mock)
      validate(task.mock, task.schema, `${name}.mock`)
    }
    if (program.models.get(task.model).config.provider === 'mock' && !task.props.mock) fail('CHECK', `Task ${name} requires a mock fixture`)
  }
  function expression(expr, scope) {
    if (expr.kind === 'variable') {
      if (!scope.has(expr.name)) fail('CHECK', `Unknown variable ${expr.name}`, expr.location)
      return scope.get(expr.name)
    }
    if (expr.kind === 'literal') return { type: expr.value === null ? 'null' : typeof expr.value }
    if (expr.kind === 'field') {
      const parent = expression(expr.object, scope)
      if (parent?.type === 'object' && parent.properties && !Object.hasOwn(parent.properties, expr.field)) fail('CHECK', `Unknown field ${expr.field}`, expr.location)
      return parent?.properties?.[expr.field]
    }
    if (expr.kind === 'call') {
      expr.args.forEach(arg => expression(arg, scope))
      if (['input', 'read_text'].includes(expr.name)) {
        if (expr.args.length !== 1) fail('CHECK', `${expr.name} expects one argument`, expr.location)
        return { type: 'string' }
      }
      const task = program.tasks.get(expr.name)
      if (!task) fail('CHECK', `Unknown task ${expr.name}`, expr.location)
      if (expr.args.length !== task.params.length) fail('CHECK', `${expr.name} expects ${task.params.length} arguments`, expr.location)
      expr.args.forEach((arg, i) => {
        if (arg.kind === 'literal') validate(arg.value, task.params[i].schema, `${expr.name}.${task.params[i].name}`)
      })
      return task.schema
    }
    if (expr.kind === 'array') { expr.items.forEach(item => expression(item, scope))
      return { type: 'array' }
    }
    if (expr.kind === 'object') return { type: 'object', properties: Object.fromEntries(expr.entries.map(([k, v]) => [k, expression(v, scope)])) }
    if (expr.kind === 'not') expression(expr.value, scope)
    if (expr.kind === 'binary') { expression(expr.left, scope)
      expression(expr.right, scope)
    }
    return { type: 'boolean' }
  }
  function statements(body, parent = new Map()) {
    const scope = new Map(parent)
    for (const stmt of body) {
      if (stmt.kind === 'let') {
        if (scope.has(stmt.name)) fail('CHECK', `Variable ${stmt.name} already exists in this scope`, stmt.location)
        scope.set(stmt.name, expression(stmt.value, scope))
      } else if (stmt.kind === 'if') {
        expression(stmt.condition, scope)
        statements(stmt.yes, scope)
        statements(stmt.no, scope)
      } else expression(stmt.value, scope)
    }
  }
  for (const flow of [...program.flows.values(), ...program.tests.values()]) statements(flow.body)
  return program
}
