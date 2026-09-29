import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { compile, run, Runtime } from '../src/index.js'

const source = await readFile(new URL('../examples/triage.hailey', import.meta.url), 'utf8')
const code = expected => error => error.code === expected
const simple = extra => `model m { provider: "mock" } task answer(x: String) -> String { model: m prompt: "{{x}}" mock: "hello" ${extra || ''} } flow main { print answer("world") }`

test('offline workflow returns typed data and records named context', async () => {
  const trace = await run(source)
  assert.equal(trace.status, 'ok')
  assert.equal(trace.outputs[0].category, 'billing')
  assert.equal(trace.outputs[1], 'Route to accounts')
  assert.deepEqual(trace.events[0].context, ['policy'])
  assert.equal(trace.events[0].estimatedCostUSD, 0)
})

test('replay makes no new requests and reproduces output', async () => {
  const trace = await run(source)
  const replayed = await run(source, { replay: trace, fetch: () => assert.fail('network called') })
  assert.deepEqual(replayed.outputs, trace.outputs)
  assert.equal(replayed.events[0].replayed, true)
})

test('replay rejects changed source, changed request, and extra events', async () => {
  const trace = await run(simple())
  await assert.rejects(run(simple() + '\n', { replay: trace }), code('REPLAY'))
  const changed = structuredClone(trace)
  changed.events[0].requestHash = 'bad'
  await assert.rejects(run(simple(), { replay: changed }), code('REPLAY'))
  const extra = structuredClone(trace)
  extra.events.push(extra.events[0])
  await assert.rejects(run(simple(), { replay: extra }), code('REPLAY'))
})

test('replay validates stored values and entry point', async () => {
  const trace = await run(simple())
  const bad = structuredClone(trace)
  bad.events[0].value = 42
  await assert.rejects(run(simple(), { replay: bad }), code('TYPE'))
  const runtime = new Runtime(compile(source), { replay: await run(source) })
  await assert.rejects(runtime.run('billing', 'test'), code('REPLAY'))
})

test('nullable fields and typed arrays work', async () => {
  const trace = await run(await readFile(new URL('../examples/extract.hailey', import.meta.url), 'utf8'))
  assert.equal(trace.outputs[0].email, null)
  assert.deepEqual(trace.outputs[0].interests, ['language design', 'AI'])
})

test('bad fields, enum members, extra keys, and missing nullable fields fail', () => {
  assert.throws(() => compile(source.replace('category: "billing"\n', 'category: "other"\n')), code('TYPE'))
  assert.throws(() => compile(source.replace('print ticket\n', 'print ticket.nope\n')), code('CHECK'))
  assert.throws(() => compile(source.replace('summary: "Customer', 'unknown: true\n    summary: "Customer')), code('TYPE'))
  assert.throws(() => compile('type T { value: String? } model m {} task t() -> T { model: m prompt: "x" mock: {} }'), code('TYPE'))
})

test('declarations, references, recursive types and template paths are checked', () => {
  for (const bad of [
    'type X { x: Missing }', 'type X { x: X }', 'type X { x: constructor }',
    'model x {} model x {}', 'model m { prvdr: "mock" }',
    simple().replace('{{x}}', '{{missing}}'),
    simple().replace('model: m', 'model: absent'),
    'flow main { print no_such_task() }', 'flow main { print missing }',
    simple().replace('answer("world")', 'answer()'),
    simple().replace('answer("world")', 'answer(2)'),
    'flow main { let x = 1 let x = 2 }'
  ]) assert.throws(() => compile(bad), undefined, bad)
})

test('multiline prompts, comments, escapes, and duplicate field errors', async () => {
  const text = simple().replace('prompt: "{{x}}"', 'prompt: """Hello\n{{x}}"""')
  const trace = await run(text)
  assert.equal(trace.events[0].messages.at(-1).content, 'Hello\nworld')
  assert.throws(() => compile('type X { a: String a: String }'), code('PARSE'))
  assert.throws(() => compile('flow main { print "broken }'), code('PARSE'))
  assert.throws(() => compile('flow main { print "\\q" }'), code('PARSE'))
  assert.throws(() => compile('flow main { print 1e999 }'), code('PARSE'))
})

test('boolean operators short circuit and branch variables stay local', async () => {
  const trace = await run('flow main { if false && input("absent") == "x" { print "wrong" } else { print !false } assert [1, 2] == [1, 2] assert 3 >= 2 }')
  assert.deepEqual(trace.outputs, [true])
  assert.throws(() => compile('flow main { if true { let x = 1 } print x }'), code('CHECK'))
  await assert.rejects(run('flow main { if "truthy" { print 1 } }'), code('TYPE'))
})

test('prototype properties are not readable', async () => {
  assert.throws(() => compile('flow main { let x = { a: 1 } print x.constructor }'), code('CHECK'))
  const trace = await run('flow main { let x = { "__proto__": "safe" } print x.__proto__ }')
  assert.deepEqual(trace.outputs, ['safe'])
})

test('maxCalls stops before execution and assertion errors remain visible', async () => {
  const runtime = new Runtime(compile(simple()), { maxCalls: 0 })
  await assert.rejects(runtime.run(), code('BUDGET'))
  assert.equal(runtime.trace.events.length, 0)
  assert.equal(runtime.trace.status, 'error')
  await assert.rejects(run('flow main { assert false }'), code('ASSERT'))
})

test('inputs are required and interpolation is single pass', async () => {
  const text = simple().replace('answer("world")', 'answer(input("message"))')
  await assert.rejects(run(text), code('INPUT'))
  const trace = await run(text, { inputs: { message: '{{secret}}' } })
  assert.equal(trace.events[0].messages.at(-1).content, '{{secret}}')
  await assert.rejects(run(text, { replay: trace, inputs: { message: 'changed' } }), code('REPLAY'))
})

test('file capability blocks traversal and symlink escape, replay reads nothing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hailey-test-'))
  try {
    await writeFile(join(dir, 'inside.txt'), 'local policy')
    const text = 'flow main { print read_text("inside.txt") }'
    await assert.rejects(run(text, { baseDir: dir }), code('CAPABILITY'))
    const trace = await run(text, { baseDir: dir, allowRead: [dir] })
    assert.deepEqual(trace.outputs, ['local policy'])
    const replayed = await run(text, { replay: trace, baseDir: '/does/not/exist' })
    assert.deepEqual(replayed.outputs, trace.outputs)
    await symlink(process.execPath, join(dir, 'escape'))
    await assert.rejects(run('flow main { print read_text("escape") }', { baseDir: dir, allowRead: [dir] }), code('CAPABILITY'))
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('CLI saves failure traces, refuses overwrite, and init never overwrites', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hailey-cli-'))
  const cli = fileURLToPath(new URL('../bin/hailey.js', import.meta.url))
  const exec = args => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' })
  try {
    assert.equal(exec(['init', dir]).status, 0)
    assert.equal(exec(['init', dir]).status, 1)
    assert.equal(exec(['check', join(dir, 'main.hailey')]).status, 0)
    assert.equal(exec(['test', join(dir, 'main.hailey')]).status, 0)
    const bad = join(dir, 'bad.hailey')
    const trace = join(dir, 'run.trace.json')
    await writeFile(bad, 'flow main { assert false }')
    assert.equal(exec(['run', bad, '--trace', trace]).status, 1)
    assert.equal(JSON.parse(await readFile(trace, 'utf8')).error.code, 'ASSERT')
    assert.equal(exec(['run', bad, '--trace', bad]).status, 1)
    assert.equal(await readFile(bad, 'utf8'), 'flow main { assert false }')
    assert.equal(exec(['run', bad, '--wat']).status, 1)
    assert.equal(exec(['run', bad, '--max-calls', 'NaN']).status, 1)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

import { fileURLToPath } from 'node:url'

test('string literals cannot stand in for declaration or statement keywords', () => {
  assert.throws(() => compile('"flow" main { print 1 }'), { code: 'PARSE' })
  assert.throws(() => compile('flow main { "print" 1 }'), { code: 'PARSE' })
})
