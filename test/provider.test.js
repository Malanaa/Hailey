import test from 'node:test'
import assert from 'node:assert/strict'
import { compile, run, Runtime } from '../src/index.js'

const source = `
model remote {
  provider: "compatible"
  endpoint: "https://example.com/v1/chat/completions"
  name: "test-model"
  api_key: "TEST_KEY"
  input_price: 2
  output_price: 8
  max_output_tokens: 100
}
task classify(message: String) -> String {
  model: remote
  prompt: "{{message}}"
  retries: 1
}
flow main { print classify("hello") }
`
const options = { env: { TEST_KEY: 'secret-test-token' } }
const response = (content = '{"result":"ok"}') => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 10 } }), { status: 200 })

test('adapter sends schema, limits, credentials and records cost without credentials', async () => {
  let calls = 0
  const trace = await run(source, { ...options, fetch: async (url, init) => {
    calls += 1
    assert.equal(url, 'https://example.com/v1/chat/completions')
    assert.equal(init.headers.Authorization, 'Bearer secret-test-token')
    assert.equal(init.redirect, 'error')
    const body = JSON.parse(init.body)
    assert.equal(body.max_completion_tokens, 100)
    assert.equal(body.response_format.json_schema.strict, true)
    assert.equal(body.response_format.json_schema.schema.properties.result.type, 'string')
    return response()
  } })
  assert.equal(calls, 1)
  assert.deepEqual(trace.outputs, ['ok'])
  assert.equal(trace.events[0].estimatedCostUSD, 0.00028)
  assert.equal(JSON.stringify(trace).includes('secret-test-token'), false)
})

test('invalid typed output retries and accounts for both billed responses', async () => {
  let count = 0
  const trace = await run(source, { ...options, fetch: async () => response(++count === 1 ? '{"result":42}' : '{"result":"ok"}') })
  assert.equal(trace.events.length, 2)
  assert.equal(trace.events[0].error.code, 'TYPE')
  assert.equal(trace.events[0].estimatedCostUSD, 0.00028)
  const replayed = await run(source, { replay: trace, fetch: () => assert.fail('replay called network') })
  assert.deepEqual(replayed.outputs, ['ok'])
})

test('retries consume the same call budget', async () => {
  let count = 0
  const runtime = new Runtime(compile(source), { ...options, maxCalls: 1, fetch: async () => { count += 1
    return response('invalid json')
  } })
  await assert.rejects(runtime.run(), { code: 'BUDGET' })
  assert.equal(count, 1)
  assert.equal(runtime.trace.events[0].error.code, 'TYPE')
})

test('HTTP 429 retries but authentication failures do not', async () => {
  let count = 0
  const trace = await run(source, { ...options, fetch: async () => ++count === 1 ? new Response('private upstream error', { status: 429 }) : response() })
  assert.equal(trace.events.length, 2)
  assert.equal(trace.events[0].estimatedCostUSD, null)
  assert.equal(JSON.stringify(trace).includes('private upstream error'), false)
  count = 0
  await assert.rejects(run(source, { ...options, fetch: async () => { count += 1
    return new Response('secret body', { status: 401 })
  } }), { code: 'PROVIDER', message: 'Provider returned HTTP 401' })
  assert.equal(count, 1)
})

test('missing credentials cause no network request', async () => {
  await assert.rejects(run(source, { env: {}, fetch: () => assert.fail('network called') }), { code: 'CONFIG' })
})

test('refusals and truncation keep usage and do not silently pass', async () => {
  for (const [finish, message, code] of [
    ['stop', { refusal: 'no' }, 'REFUSAL'],
    ['length', { content: '{"result":"partial"}' }, 'TRUNCATED']
  ]) {
    const runtime = new Runtime(compile(source), { ...options, fetch: async () => new Response(JSON.stringify({ choices: [{ finish_reason: finish, message }], usage: { prompt_tokens: 100, completion_tokens: 10 } })) })
    await assert.rejects(runtime.run(), { code })
    assert.equal(runtime.trace.events.length, 1)
    assert.equal(runtime.trace.events[0].estimatedCostUSD, 0.00028)
  }
})

test('unknown usage stays unknown and json_object compatibility is configurable', async () => {
  const text = source.replace('max_output_tokens: 100', 'max_output_tokens: 100 format: "json_object" token_parameter: "max_tokens"')
  const trace = await run(text, { ...options, fetch: async (_, init) => {
    const body = JSON.parse(init.body)
    assert.equal(body.max_tokens, 100)
    assert.deepEqual(body.response_format, { type: 'json_object' })
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"result":"ok"}' } }] }))
  } })
  assert.equal(trace.events[0].usage, null)
  assert.equal(trace.events[0].estimatedCostUSD, null)
})

test('timeout is typed and bounded by the configured retry count', async () => {
  let count = 0
  await assert.rejects(run(source, { ...options, fetch: async () => { count += 1
    throw new DOMException('timeout', 'TimeoutError')
  } }), { code: 'TIMEOUT' })
  assert.equal(count, 2)
})

test('unsafe endpoints and invalid model settings fail before execution', () => {
  for (const endpoint of ['http://example.com/chat', 'https://user:pass@example.com/chat', 'https://example.com/chat?token=x']) {
    assert.throws(() => compile(source.replace('https://example.com/v1/chat/completions', endpoint)), { code: 'CHECK' })
  }
  for (const text of [source.replace('input_price: 2', 'input_price: -2'), source.replace('output_price: 8', ''), source.replace('max_output_tokens: 100', 'max_output_tokens: 0')]) assert.throws(() => compile(text), { code: 'CHECK' })
})
