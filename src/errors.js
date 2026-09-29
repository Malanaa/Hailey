export class HaileyError extends Error {
  constructor(code, message, location) {
    super(message)
    this.name = 'HaileyError'
    this.code = code
    this.location = location
  }
}

export function fail(code, message, location) {
  throw new HaileyError(code, message, location)
}
