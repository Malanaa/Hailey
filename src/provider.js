import { HaileyError, fail } from './errors.js'

export async function complete(config, request, options = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (config.api_key) {
    const key = (options.env || process.env)[config.api_key]
    if (!key) fail('CONFIG', `Environment variable ${config.api_key} is not set`)
    headers.Authorization = `Bearer ${key}`
  }
  const body = {
    model: config.name,
    messages: request.messages,
    [config.token_parameter]: config.max_output_tokens,
    response_format: config.format === 'json_schema'
      ? { type: 'json_schema', json_schema: { name: 'hailey_result', strict: true, schema: request.schema } }
      : { type: 'json_object' }
  }
  let response
  let data
  try {
    response = await (options.fetch || fetch)(config.endpoint, {
      method: 'POST', headers, body: JSON.stringify(body), redirect: 'error',
      signal: AbortSignal.timeout(config.timeout_ms)
    })
    if (!response.ok) {
      const error = new HaileyError('PROVIDER', `Provider returned HTTP ${response.status}`)
      error.retryable = [408, 429, 500, 502, 503, 504].includes(response.status)
      throw error
    }
    // Provider bodies can contain sensitive text. Never echo error bodies.
    data = await response.json()
  } catch (error) {
    if (error instanceof HaileyError) throw error
    const timedOut = ['TimeoutError', 'AbortError'].includes(error.name)
    const wrapped = new HaileyError(timedOut ? 'TIMEOUT' : 'PROVIDER', timedOut ? 'Model request timed out' : 'Network failure or invalid provider response')
    wrapped.retryable = true
    throw wrapped
  }
  const usage = data.usage && Number.isSafeInteger(data.usage.prompt_tokens) && data.usage.prompt_tokens >= 0 && Number.isSafeInteger(data.usage.completion_tokens) && data.usage.completion_tokens >= 0
    ? { inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens } : null
  const choice = data.choices?.[0]
  const error = (code, message) => {
    const e = new HaileyError(code, message)
    e.usage = usage
    throw e
  }
  if (choice?.message?.refusal) error('REFUSAL', 'The model refused this request')
  if (choice?.finish_reason === 'length') error('TRUNCATED', 'Model output reached its token limit')
  if (choice?.finish_reason === 'content_filter') error('REFUSAL', 'The provider filtered this response')
  if (typeof choice?.message?.content !== 'string') error('PROVIDER', 'Provider did not return text content')
  return { content: choice.message.content, usage }
}
