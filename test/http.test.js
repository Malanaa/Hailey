import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { run } from '../src/index.js'

test('real HTTP transport sends and validates a complete provider exchange', async () => {
  let observed
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    observed = { url: request.url, method: request.method, body: JSON.parse(body), authorization: request.headers.authorization }
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ choices: [{ message: { content: '{"result":{"label":"billing"}}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 8 } }))
  })
  await new Promise((done, reject) => { server.once('error', reject)
    server.listen(0, '127.0.0.1', done)
  })
  try {
    const { port } = server.address()
    const source = `type Label { label: "billing" | "bug" }
model local { provider: "compatible" endpoint: "http://127.0.0.1:${port}/v1/chat/completions" name: "integration" api_key: "TEST_TOKEN" }
task classify(text: String) -> Label { model: local prompt: "{{text}}" }
flow main { print classify("Duplicate charge") }`
    const trace = await run(source, { env: { TEST_TOKEN: 'local-test-only' } })
    assert.deepEqual(trace.outputs, [{ label: 'billing' }])
    assert.equal(observed.url, '/v1/chat/completions')
    assert.equal(observed.method, 'POST')
    assert.equal(observed.authorization, 'Bearer local-test-only')
    assert.equal(observed.body.model, 'integration')
    assert.deepEqual(trace.events[0].usage, { inputTokens: 20, outputTokens: 8 })
    const replayed = await run(source, { replay: trace, fetch: () => assert.fail('Unexpected HTTP call') })
    assert.deepEqual(replayed.outputs, trace.outputs)
  } finally {
    server.closeAllConnections()
    await new Promise(done => server.close(done))
  }
})
