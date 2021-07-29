import { parse } from 'graphql'
import type { Handler } from 'worktop'
import { SHA256 } from 'worktop/crypto'
import { find, save } from '../stores/QueryCache'

declare const GRAPHQL_URL: string
declare const DEFAULT_TTL: string

enum Headers {
  gcdnCache = 'gcdn-cache',
  setCookie = 'set-cookie',
  contentType = 'content-type',
  cacheControl = 'cache-control',
  date = 'date',
  age = 'age',
  xCache = 'x-cache',

  // CORS
  accessControlAllowCredentials = 'access-control-allow-credentials',
  accessControlAllowHeaders = 'access-control-allow-headers',
  accessControlAllowMethods = 'access-control-allow-methods',
  accessControlAllowOrigin = 'access-control-allow-origin',
  accessControlExposeHeaders = 'access-control-expose-headers',
  accessControlMaxAge = 'access-control-max-age',
}

enum CacheHitHeader {
  MISS = 'MISS',
  HIT = 'HIT',
  PASS = 'PASS',
  ERROR = 'ERROR',
}

const origin = GRAPHQL_URL
const defaultMaxAgeInSeconds = parseInt(DEFAULT_TTL)

export const isMutation = (document: string): boolean => {
  const node = parse(document)
  return node.definitions.some(
    (definition) =>
      definition.kind === 'OperationDefinition' &&
      definition.operation === 'mutation',
  )
}

export const isResponseCacheable = (res: Response): boolean => {
  return res.headers.get(Headers.setCookie) === null && res.status === 200
}

export const parseMaxAge = (header: string): number => {
  const matches = header.match(/max-age=(\d+)/)
  return matches ? parseInt(matches[1]) : -1
}

export const graphql: Handler = async function (req, res) {
  const originalBody = await req.body.json()
  let queryHash = ''
  let isIdempotent = false

  const defaultResponseHeaders: Record<string, string> = {
    [Headers.contentType]: 'application/json',
    [Headers.date]: new Date(Date.now()).toUTCString(),
    [Headers.accessControlMaxAge]: '300',
    [Headers.xCache]: CacheHitHeader.MISS,
    [Headers.gcdnCache]: CacheHitHeader.MISS,
  }

  if (originalBody.query) {
    queryHash = await SHA256(originalBody.query)

    /**
     * Check if we received a query or mutation.
     * Parsing the query can throw.
     */
    try {
      isIdempotent = !isMutation(originalBody.query)
      console.log('Query hash: ' + queryHash)
      console.log('IsIdempotent', isIdempotent)
    } catch (error) {
      const headers: Record<string, string> = {
        [Headers.gcdnCache]: CacheHitHeader.HIT,
        [Headers.xCache]: CacheHitHeader.HIT,
      }
      return res.send(400, error, {
        ...defaultResponseHeaders,
        ...headers,
      })
    }
  }

  /**
   * Check if query is in the cache
   */
  if (queryHash) {
    const { value, metadata } = await find(queryHash)

    if (value) {
      const headers: Record<string, string> = {
        [Headers.gcdnCache]: CacheHitHeader.HIT,
        [Headers.xCache]: CacheHitHeader.HIT,
      }
      if (metadata) {
        headers[
          Headers.cacheControl
        ] = `public, max-age=${metadata.expirationTtl}, stale-while-revalidate=${metadata.expirationTtl}`

        const age = Math.round((Date.now() - metadata.createdAt) / 1000)
        headers[Headers.age] =
          age > metadata.expirationTtl ? metadata.expirationTtl : age
      }

      return res.send(200, value, {
        ...defaultResponseHeaders,
        ...headers,
      })
    }
  }

  const init = {
    ...req,
    body: JSON.stringify(originalBody),
  }

  /**
   * Refresh content from origin
   */
  const response = await fetch(origin, init)

  const isCacheable = isIdempotent && queryHash && isResponseCacheable(response)
  const contentType = response.headers.get(Headers.contentType)

  if (contentType?.includes('application/json')) {
    const originResult = await response.json()
    const results = JSON.stringify(originResult)
    const maxAgeHeaderValue = response.headers.get(Headers.cacheControl)

    if (isCacheable) {
      let maxAge = defaultMaxAgeInSeconds
      if (maxAgeHeaderValue) {
        const parsedMaxAge = parseMaxAge(maxAgeHeaderValue)
        maxAge = parsedMaxAge > -1 ? parsedMaxAge : defaultMaxAgeInSeconds
      }

      const result = await save(queryHash, results, maxAge)

      if (!result) {
        console.error('query could not be stored in cache')
      }

      const headers = {
        [Headers.gcdnCache]: CacheHitHeader.PASS,
        [Headers.cacheControl]: `public, max-age=${maxAge}, stale-while-revalidate=${maxAge}`,
      }

      return new Response(results, {
        ...response,
        headers: {
          ...response.headers,
          ...defaultResponseHeaders,
          ...headers,
        },
      })
    }

    // First call or mutation requests
    return new Response(results, {
      ...response,
      headers: {
        ...response.headers,
        ...defaultResponseHeaders,
        [Headers.gcdnCache]: CacheHitHeader.PASS,
      },
    })
  }

  // We only understand JSON
  return res.send(
    415,
    { error: `Unsupported content-type "${contentType}" from origin.` },
    {
      ...defaultResponseHeaders,
      [Headers.gcdnCache]: CacheHitHeader.PASS,
    },
  )
}
