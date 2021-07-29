import type { Handler } from 'worktop'
import { SHA256 } from 'worktop/crypto'
import {
  normalizeDocument,
  isMutation,
  hasIntersectedTypes,
} from '../graphql-utils'
import {
  Headers,
  CacheHitHeader,
  isResponseCachable,
  parseMaxAge,
  isResponsePrivate,
} from '../utils'
import { find, save } from '../stores/QueryCache'
import { latest } from '../stores/Schema'
import { parse } from 'graphql'

declare const GRAPHQL_URL: string
declare const DEFAULT_TTL: string
declare const PRIVATE_TYPES: string

const origin = GRAPHQL_URL
const defaultMaxAgeInSeconds = parseInt(DEFAULT_TTL)
const privateTypes = PRIVATE_TYPES.split(',')

export const graphql: Handler = async function (req, res) {
  const originalBody = await req.body.json()

  if (!originalBody.query) {
    return res.send(400, {
      error: 'Request has no "query" field.',
    })
  }

  let isMutationRequest = false

  const defaultResponseHeaders: Record<string, string> = {
    [Headers.contentType]: 'application/json',
    [Headers.date]: new Date(Date.now()).toUTCString(),
    [Headers.accessControlMaxAge]: '300',
    [Headers.xCache]: CacheHitHeader.MISS,
    [Headers.gcdnCache]: CacheHitHeader.MISS,
  }

  const queryDocumentNode = parse(originalBody.query, { noLocation: true })

  if (originalBody.query) {
    /**
     * Check if we received a query or mutation.
     * Parsing the query can throw.
     */
    try {
      isMutationRequest = isMutation(queryDocumentNode)
    } catch (error) {
      return res.send(400, error, {
        ...defaultResponseHeaders,
        ...{
          [Headers.gcdnCache]: CacheHitHeader.ERROR,
          [Headers.xCache]: CacheHitHeader.HIT,
        },
      })
    }
  }

  const schema = await latest()
  let hasPrivateTypes = false

  if (schema && privateTypes.length > 0) {
    hasPrivateTypes = hasIntersectedTypes(
      schema,
      queryDocumentNode,
      privateTypes,
    )
  }

  const content = normalizeDocument(originalBody.query)

  const authHeader = req.headers.get(Headers.authorization) || ''

  let querySignature = ''

  /**
   *  In case of the query will return user specific data the response
   *  is only cached for the user.
   */
  if (hasPrivateTypes) {
    querySignature = await SHA256(authHeader + content)
  } else {
    querySignature = await SHA256(content)
  }

  /**
   * Check if query is in the cache
   */
  if (querySignature) {
    const { value, metadata } = await find(querySignature)

    if (value) {
      const res = new Response(value.body, {
        headers: {
          ...value.headers,
          ...defaultResponseHeaders,
        },
      })

      if (metadata) {
        res.headers.set(
          Headers.cacheControl,
          `public, max-age=${metadata.expirationTtl}, stale-while-revalidate=${metadata.expirationTtl}`,
        )

        const age = Math.round((Date.now() - metadata.createdAt) / 1000)
        res.headers.set(
          Headers.age,
          (age > metadata.expirationTtl
            ? metadata.expirationTtl
            : age
          ).toString(),
        )
      }

      res.headers.set(Headers.gcdnCache, CacheHitHeader.HIT)
      res.headers.set(Headers.xCache, CacheHitHeader.HIT)

      return res
    }
  }

  /**
   * Refresh content from origin
   */
  const response = await fetch(origin, {
    body: JSON.stringify(originalBody),
    headers: req.headers,
    method: req.method,
  })

  const isCacheable =
    !isMutationRequest &&
    (isResponseCachable(response) ||
      (hasPrivateTypes && isResponsePrivate(response)))

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

      const res = new Response(results, {
        ...response,
        headers: {
          ...response.headers,
          ...defaultResponseHeaders,
        },
      })

      if (res.headers.has('Set-Cookie')) {
        res.headers.append('Cache-Control', 'private=Set-Cookie')
      }

      const serializableHeaders: Record<string, string> = {}
      res.headers.forEach((val, key) => (serializableHeaders[key] = val))

      const result = await save(
        querySignature,
        {
          headers: serializableHeaders,
          body: results,
        },
        maxAge,
      )

      if (!result) {
        console.error('query could not be stored in cache')
      }

      res.headers.set(Headers.gcdnCache, CacheHitHeader.PASS)
      res.headers.set(
        Headers.cacheControl,
        `public, max-age=${maxAge}, stale-while-revalidate=${maxAge}`,
      )

      return res
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
    {
      error: `Unsupported content-type "${contentType}" from origin "${origin}".`,
    },
    {
      ...defaultResponseHeaders,
      [Headers.gcdnCache]: CacheHitHeader.PASS,
    },
  )
}
