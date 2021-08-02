import { ServerRequest } from 'worktop/request'
import { ServerResponse } from 'worktop/response'
import { createHash, randomBytes } from 'crypto'

// @ts-ignore
globalThis.ORIGIN_URL = 'https://grapql-endpoint/'
// @ts-ignore
globalThis.DEFAULT_TTL = '900'
// @ts-ignore
globalThis.PRIVATE_TYPES = ''
// @ts-ignore
globalThis.INJECT_ORIGIN_HEADERS = ''
// @ts-ignore
globalThis.SCOPE = ''
// @ts-ignore
globalThis.IGNORE_ORIGIN_CACHE_HEADERS = ''
// @ts-ignore
globalThis.AUTH_DIRECTIVE = ''
// @ts-ignore
globalThis.SCHEMA_STRING = ''
// @ts-ignore
globalThis.SWR = '900'
// @ts-ignore
globalThis.APQ_TTL = '900'

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

globalThis.Date.now = () => 1627670799330

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

export const WorktopResponse = () => {
  let headers = Headers(null)
  let body: any,
    finished = false,
    statusCode = 0
  // @ts-ignore
  return {
    get headers() {
      return headers
    },
    finished,
    get statusCode() {
      return statusCode
    },
    setHeader: headers.set,
    get body() {
      return JSON.stringify(body)
    },
    send: (code, payload, h?: { [s: string]: string }) => {
      statusCode = code
      body = payload
      if (h) {
        headers = new globalThis.Headers(Object.entries(h))
      }
    },
    end(val: any) {
      finished = true
      body = val
    },
  } as ServerResponse
}

export const WorktopRequest = (
  method = 'POST',
  payload: object | null = null,
  query: URLSearchParams = new URLSearchParams(),
  headers: Headers = Headers(null),
): ServerRequest => {
  return {
    method,
    query,
    headers,
    body: {
      json() {
        return Promise.resolve(payload)
      },
    },
  } as ServerRequest
}

export const createKVNamespaces = (
  namespaces: string[],
  store: Map<string, any> = new Map(),
  metadata: Map<string, any> = new Map(),
) => {
  for (const namespace of namespaces) {
    NewKVNamespace(
      {
        name: namespace,
      },
      store,
      metadata,
    )
  }
}

export const NewKVNamespace = (
  bindingConfig: { name: string },
  store: Map<string, any> = new Map(),
  metadata: Map<string, any> = new Map(),
) => {
  let binding = Namespace()
  binding.get = (key: string, type: string) => {
    const m = store.has(key)
    if (m) {
      const val = store.get(key)
      return Promise.resolve(type === 'json' ? JSON.parse(val) : val)
    }
    return Promise.resolve(null)
  }
  binding.delete = (key: string) => {
    store.delete(key)
    metadata.delete(key)
    return Promise.resolve()
  }
  binding.put = (key: string, value: any, m: any) => {
    store.set(key, value)
    metadata.set(key, m)
    return Promise.resolve()
  }
  binding.getWithMetadata = async (
    key: string,
    options: { metadata: boolean; type: string },
  ) => {
    const m = metadata.get(key)
    return {
      value: await binding.get(key, options.type),
      metadata: m?.metadata,
    }
  }
  // @ts-ignore
  globalThis[bindingConfig.name] = binding

  return { store, metadata }
}

// @ts-ignore - faking it
globalThis.Headers = class Headers extends Map {
  get(key: string) {
    return super.get(key.toLowerCase())
  }
  has(key: string) {
    return super.has(key.toLowerCase())
  }
  set(key: string, value: string) {
    return super.set(key.toLowerCase(), value)
  }
  append(key: string, val: string) {
    let prev = this.get(key) || ''
    if (prev) prev += ', '
    this.set(key, prev + val)
  }
}

// @ts-ignore - faking it
globalThis.fetch = async function Fetch(url: RequestInfo, init?: RequestInit) {
  let headers
  if (init) {
    if (init.headers instanceof globalThis.Headers) {
      headers = init.headers
    } else if (init.headers) {
      headers = new globalThis.Headers(Object.entries(init.headers as any))
    } else {
      headers = new globalThis.Headers()
    }
  }

  return {
    headers,
    json() {
      return null
    },
  }
}

export const mockFetch = (
  json: any,
  headers: { [s: string]: any } = new globalThis.Headers(),
) => {
  // @ts-ignore
  const oldFetch = globalThis.fetch

  return {
    mock() {
      // @ts-ignore - faking it
      globalThis.fetch = async () => {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new globalThis.Headers(Object.entries(headers)),
          json() {
            return json
          },
        }
      }

      return this
    },
    revert() {
      globalThis.fetch = oldFetch
    },
  }
}

export const getKVEntries = (m: Map<string, any>, json = true) => {
  const obj: { [k: string]: any } = {}
  for (const [key, val] of m) {
    obj[key] = json ? JSON.parse(val) : val
  }
  return obj
}
