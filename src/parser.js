import { fail } from './errors.js'

export function tokenize(source) {
  const tokens = []
  let offset = 0
  let line = 1
  let column = 1
  const advance = text => {
    for (const char of text) {
      if (char === '\n') { line += 1
        column = 1
      } else column += 1
    }
    offset += text.length
  }
  while (offset < source.length) {
    const rest = source.slice(offset)
    const location = { line, column }
    const whitespace = rest.match(/^\s+/)
    if (whitespace) { advance(whitespace[0])
      continue
    }
    if (rest.startsWith('//') || rest.startsWith('#')) {
      advance(rest.split('\n')[0])
      continue
    }
    if (rest.startsWith('"""')) {
      const end = source.indexOf('"""', offset + 3)
      if (end < 0) fail('PARSE', 'Unclosed multiline string', location)
      const raw = source.slice(offset, end + 3)
      tokens.push({ kind: 'string', value: raw.slice(3, -3), ...location })
      advance(raw)
      continue
    }
    if (rest[0] === '"') {
      const match = rest.match(/^"(?:[^"\\\n\r]|\\.)*"/)
      if (!match) fail('PARSE', 'Invalid or unclosed string', location)
      let value
      try { value = JSON.parse(match[0]) } catch { fail('PARSE', 'Invalid string escape', location) }
      tokens.push({ kind: 'string', value, ...location })
      advance(match[0])
      continue
    }
    const number = rest.match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/)
    if (number) {
      const value = Number(number[0])
      if (!Number.isFinite(value)) fail('PARSE', 'Numbers must be finite', location)
      tokens.push({ kind: 'number', value, ...location })
      advance(number[0])
      continue
    }
    const name = rest.match(/^[A-Za-z_][A-Za-z0-9_]*/)
    if (name) {
      tokens.push({ kind: 'name', value: name[0], ...location })
      advance(name[0])
      continue
    }
    const symbol = ['->', '==', '!=', '<=', '>=', '&&', '||'].find(s => rest.startsWith(s)) || rest[0]
    if (!['->', '==', '!=', '<=', '>=', '&&', '||', '{', '}', '(', ')', '[', ']', ':', ',', '=', '.', '|', '?', '<', '>', '!'].includes(symbol)) {
      fail('PARSE', `Unexpected character ${JSON.stringify(symbol)}`, location)
    }
    tokens.push({ kind: 'symbol', value: symbol, ...location })
    advance(symbol)
  }
  tokens.push({ kind: 'eof', value: '<end>', line, column })
  return tokens
}

export function parse(source) {
  const tokens = tokenize(source)
  let index = 0
  const peek = () => tokens[index]
  const is = value => peek().value === value && peek().kind !== 'string'
  const take = () => tokens[index++]
  const expect = value => {
    if (!is(value)) fail('PARSE', `Expected ${value}, found ${peek().value}`, peek())
    return take()
  }
  const name = () => {
    if (peek().kind !== 'name') fail('PARSE', 'Expected a name', peek())
    return take().value
  }
  const comma = () => { if (is(',')) take() }
  function type() {
    let result
    if (peek().kind === 'string') {
      const values = [take().value]
      while (is('|')) { take()
        if (peek().kind !== 'string') fail('PARSE', 'Enum choices must be strings', peek())
        values.push(take().value)
      }
      result = { kind: 'enum', values }
    } else result = { kind: 'ref', name: name() }
    while (is('[')) { take()
      expect(']')
      result = { kind: 'array', item: result }
    }
    if (is('?')) { take()
      result = { kind: 'nullable', item: result }
    }
    return result
  }
  function primary() {
    const token = take()
    let expr
    if (token.kind === 'string' || token.kind === 'number') expr = { kind: 'literal', value: token.value }
    else if (token.value === 'true' || token.value === 'false' || token.value === 'null') expr = { kind: 'literal', value: JSON.parse(token.value) }
    else if (token.value === '!') expr = { kind: 'not', value: primary() }
    else if (token.value === '(') { expr = expression()
      expect(')')
    } else if (token.value === '[') {
      const items = []
      while (!is(']')) { items.push(expression())
        comma()
      }
      take()
      expr = { kind: 'array', items }
    } else if (token.value === '{') {
      const entries = []
      const names = new Set()
      while (!is('}')) {
        const key = peek().kind === 'string' ? take().value : name()
        if (names.has(key)) fail('PARSE', `Duplicate field ${key}`, peek())
        names.add(key)
        expect(':')
        entries.push([key, expression()])
        comma()
      }
      take()
      expr = { kind: 'object', entries }
    } else if (token.kind === 'name') {
      expr = { kind: 'variable', name: token.value }
      if (is('(')) {
        take()
        const args = []
        while (!is(')')) { args.push(expression())
          if (!is(')')) expect(',')
        }
        take()
        expr = { kind: 'call', name: token.value, args }
      }
    } else fail('PARSE', `Expected an expression, found ${token.value}`, token)
    while (is('.')) { take()
      expr = { kind: 'field', object: expr, field: name() }
    }
    return { ...expr, location: token }
  }
  const precedence = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '>': 4, '<=': 4, '>=': 4 }
  function expression(min = 0) {
    let left = primary()
    while (peek().kind === 'symbol' && (precedence[peek().value] || 0) > min) {
      const op = take().value
      left = { kind: 'binary', op, left, right: expression(precedence[op]), location: left.location }
    }
    return left
  }
  function properties() {
    const props = Object.create(null)
    expect('{')
    while (!is('}')) {
      const key = name()
      if (Object.hasOwn(props, key)) fail('PARSE', `Duplicate property ${key}`, peek())
      expect(':')
      props[key] = expression()
      comma()
    }
    take()
    return props
  }
  function statements() {
    const body = []
    expect('{')
    while (!is('}')) {
      const token = take()
      if (token.kind !== 'name') fail('PARSE', 'Expected a statement keyword', token)
      if (token.value === 'let') {
        const id = name()
        expect('=')
        body.push({ kind: 'let', name: id, value: expression(), location: token })
      } else if (token.value === 'print' || token.value === 'assert') {
        body.push({ kind: token.value, value: expression(), location: token })
      } else if (token.value === 'if') {
        const condition = expression()
        const yes = statements()
        const no = is('else') ? (take(), statements()) : []
        body.push({ kind: 'if', condition, yes, no, location: token })
      } else fail('PARSE', `Expected let, print, assert, or if, found ${token.value}`, token)
    }
    take()
    return body
  }
  const program = { types: new Map(), models: new Map(), contexts: new Map(), tasks: new Map(), flows: new Map(), tests: new Map(), source }
  const all = new Set(['String', 'Number', 'Int', 'Bool', 'input', 'read_text'])
  while (peek().kind !== 'eof') {
    const token = take()
    if (token.kind !== 'name') fail('PARSE', 'Expected a declaration keyword', token)
    const id = name()
    if (all.has(id)) fail('PARSE', `Duplicate or reserved name ${id}`, token)
    all.add(id)
    if (token.value === 'type') {
      const fields = Object.create(null)
      expect('{')
      while (!is('}')) {
        const key = name()
        if (Object.hasOwn(fields, key)) fail('PARSE', `Duplicate field ${key}`, peek())
        expect(':')
        fields[key] = type()
        comma()
      }
      take()
      program.types.set(id, { fields, location: token })
    } else if (token.value === 'model' || token.value === 'context') {
      program[token.value === 'model' ? 'models' : 'contexts'].set(id, { props: properties(), location: token })
    } else if (token.value === 'task') {
      expect('(')
      const params = []
      while (!is(')')) {
        const param = name()
        if (params.some(p => p.name === param)) fail('PARSE', `Duplicate parameter ${param}`, peek())
        expect(':')
        params.push({ name: param, type: type() })
        if (!is(')')) expect(',')
      }
      take()
      expect('->')
      const returns = type()
      program.tasks.set(id, { params, returns, props: properties(), location: token })
    } else if (token.value === 'flow' || token.value === 'test') {
      program[token.value === 'flow' ? 'flows' : 'tests'].set(id, { body: statements(), location: token })
    } else fail('PARSE', `Unknown declaration ${token.value}`, token)
  }
  return program
}
