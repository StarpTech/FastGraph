import { ServerRequest } from 'worktop/request'
import { ServerResponse } from 'worktop/response'
import { createHash, randomBytes } from 'crypto'

globalThis.crypto = {
  // @ts-ignore
  getRandomValues(arr: Uint8Array) {
    return randomBytes(arr.length)
  },
  // @ts-ignore
  subtle: {
    // @ts-ignore
    async digest(algorithm: string, data: string) {
      const hash = createHash('sha256')
      hash.update(data)
      return hash.digest()
    },
  },
}

globalThis.btoa = (x) => Buffer.from(x).toString('base64')
globalThis.atob = (x) => Buffer.from(x, 'base64').toString()

// @ts-ignore - just for instanceof check
globalThis.ReadableStream = class ReadableStream {}

export const Namespace = () => ({} as any)
export const Mock = (x?: any) => {
  let args: any[],
    f = (...y: any[]) => ((args = y), Promise.resolve(x))
  // @ts-ignore
  return (f.args = () => args), f
}

export const Headers = (init: readonly [string, string][] | null) => {
  let raw = new Map(init)
  let set = raw.set.bind(raw)
  // @ts-ignore - mutating
  raw.set = (k, v) => set(k, String(v))
  // @ts-ignore - mutating
  raw.append = (k, v) => {
    let val = raw.get(k) || ''
    if (val) val += ', '
    val += String(v)
    set(k, val)
  }
  // @ts-ignore - ctor
  return raw as Headers
}

export const Response = () => {
  let headers = Headers(null)
  let body: any,
    finished = false,
    statusCode = 0
  // @ts-ignore
  return {
    headers,
    finished,
    get statusCode() {
      return statusCode
    },
    setHeader: headers.set,
    get body() {
      return body
    },
    send: (code, payload) => {
      statusCode = code
      body = payload
    },
    end(val: any) {
      finished = true
      body = val
    },
  } as ServerResponse
}

export const Request = (
  method = 'GET',
  queryString = '',
  payload: object | null = null,
  headers: Headers = Headers(null),
): ServerRequest => {
  let query = new URLSearchParams(queryString)
  return {
    method,
    headers,
    query,
    body() {
      return Promise.resolve(payload)
    },
  } as ServerRequest
}

export const createEmptyKVNamespaces = (namespaces: string[]) => {
  for (const namespace of namespaces) {
    NewKVNamespace({
      name: namespace,
    })
  }
}

export const NewKVNamespace = (
  bindingConfig: { name: string },
  store: Map<string, any> = new Map(),
) => {
  let binding = Namespace()
  binding.get = (key: string, format: string) => {
    const m = store.has(key)
    if (m) {
      const val = store.get(key)
      return Promise.resolve(format === 'json' ? JSON.parse(val) : val)
    }
    return Promise.resolve(null)
  }
  binding.delete = (key: string) => {
    store.delete(key)
    return Promise.resolve()
  }
  binding.put = (key: string, value: any) => {
    store.set(key, value)
    return Promise.resolve()
  }
  // @ts-ignore
  globalThis[bindingConfig.name] = binding

  return store
}
