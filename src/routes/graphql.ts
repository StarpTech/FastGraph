import type { Handler } from 'worktop'
import { SHA256 } from 'worktop/crypto'
import retry from 'async-retry'
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
  Scope,
} from '../utils'
import { find, save } from '../stores/QueryCache'
import { latest } from '../stores/Schema'
import { parse } from 'graphql'
import { HTTPResponseError } from '../errors'

declare const ORIGIN_URL: string
declare const DEFAULT_TTL: string
declare const PRIVATE_TYPES: string
declare const INJECT_ORIGIN_HEADERS: string
declare const SCOPE: string
declare const IGNORE_ORIGIN_CACHE_HEADERS: string

const originUrl = ORIGIN_URL
const defaultMaxAgeInSeconds = parseInt(DEFAULT_TTL)
const privateTypes = PRIVATE_TYPES ? PRIVATE_TYPES.split(',') : []
const injectOriginHeaders = !!INJECT_ORIGIN_HEADERS
const scope: Scope = SCOPE as Scope
const ignoreOriginCacheHeaders = !!IGNORE_ORIGIN_CACHE_HEADERS

type GraphQLRequest = {
  query: string
  operationName?: string
  variables?: Record<string, any>
}

export const graphql: Handler = async function (req, res) {
  const originalBody = await req.body.json<GraphQLRequest>()

  if (!originalBody.query) {
    return res.send(400, {
      error: 'Request has no "query" field.',
    })
  }

  const defaultResponseHeaders: Record<string, string> = {
    [Headers.contentType]: 'application/json',
    [Headers.date]: new Date(Date.now()).toUTCString(),
    [Headers.xCache]: CacheHitHeader.MISS,
    [Headers.gcdnCache]: CacheHitHeader.MISS,
    [Headers.gcdnOriginIgnoreCacheHeaders]: ignoreOriginCacheHeaders
      ? 'true'
      : 'false',
    [Headers.xFrameOptions]: 'deny',
    [Headers.xRobotsTag]: 'noindex',
    [Headers.vary]: 'Accept-Encoding, Accept, X-Requested-With, Origin',

    [Headers.contentSecurityPolicy]: `default-src 'none'`,
    [Headers.strictTransportSecurity]:
      'max-age=31536000; includeSubdomains; preload',
  }

  const queryDocumentNode = parse(originalBody.query, { noLocation: true })
  let hasPrivateTypes = false
  let isMutationRequest = false
  let content = undefined

  try {
    if (privateTypes.length > 0) {
      const schema = await latest()

      if (schema) {
        hasPrivateTypes = hasIntersectedTypes(
          schema,
          queryDocumentNode,
          privateTypes,
        )
      }
    }

    content = normalizeDocument(originalBody.query)
    isMutationRequest = isMutation(queryDocumentNode)
  } catch (error) {
    return res.send(400, error, {
      ...defaultResponseHeaders,
      [Headers.gcdnCache]: CacheHitHeader.ERROR,
      [Headers.xCache]: CacheHitHeader.HIT,
    })
  }

  const authHeader = req.headers.get(Headers.authorization) || ''
  const isPrivateAndCacheable =
    isMutationRequest === false &&
    (hasPrivateTypes || scope === Scope.AUTHENTICATED)
  let querySignature = ''

  /**
   *  In case of the query will return user specific data the response
   *  is cached user specific based on the Authorization header
   */
  if (isPrivateAndCacheable) {
    querySignature = await SHA256(authHeader + content)
  } else if (isMutationRequest === false) {
    querySignature = await SHA256(content)
  }

  /**
   * Check if query is in the cache
   */
  if (isMutationRequest === false) {
    const { value, metadata } = await find(querySignature)

    if (value) {
      const headers: Record<string, string> = {
        [Headers.gcdnCache]: CacheHitHeader.HIT,
        [Headers.xCache]: CacheHitHeader.HIT,
      }
      if (metadata) {
        const age = Math.round((Date.now() - metadata.createdAt) / 1000)
        headers[Headers.age] = (
          age > metadata.expirationTtl ? metadata.expirationTtl : age
        ).toString()
      }

      return res.send(200, value.body, {
        ...value.headers,
        ...defaultResponseHeaders,
        ...headers,
      })
    }
  }

  /**
   * Refresh content from origin
   */
  let originResponse = null

  try {
    originResponse = await retry(
      async () => {
        const resp = await fetch(originUrl, {
          body: JSON.stringify(originalBody),
          headers: req.headers,
          method: req.method,
        })

        if (!resp.ok) {
          throw new HTTPResponseError(resp)
        }

        return resp
      },
      {
        retries: 5,
        maxTimeout: 5000,
      },
    )
  } catch (error) {
    if (error instanceof HTTPResponseError) {
      defaultResponseHeaders[Headers.gcdnOriginStatusCode] =
        error.response.status.toString()
      defaultResponseHeaders[Headers.gcdnOriginStatusText] =
        error.response.statusText.toString()
      return res.send(
        500,
        {
          error: 'Origin error',
        },
        {
          ...defaultResponseHeaders,
        },
      )
    }
    throw error
  }

  defaultResponseHeaders[Headers.gcdnOriginStatusCode] =
    originResponse.status.toString()
  defaultResponseHeaders[Headers.gcdnOriginStatusText] =
    originResponse.statusText.toString()

  const isOriginResponseCacheable =
    isResponseCachable(originResponse) || ignoreOriginCacheHeaders
  const isCacheable =
    (isMutationRequest === false && isOriginResponseCacheable) ||
    (isOriginResponseCacheable && isPrivateAndCacheable)

  const contentType = originResponse.headers.get(Headers.contentType)
  const originHeaders = Object.fromEntries(originResponse.headers)

  if (contentType?.includes('application/json')) {
    const originResult = await originResponse.json()
    const results = JSON.stringify(originResult)

    if (isCacheable) {
      let maxAge = defaultMaxAgeInSeconds
      const maxAgeHeaderValue = originResponse.headers.get(Headers.cacheControl)
      if (ignoreOriginCacheHeaders === false) {
        if (maxAgeHeaderValue) {
          const parsedMaxAge = parseMaxAge(maxAgeHeaderValue)
          maxAge = parsedMaxAge > -1 ? parsedMaxAge : defaultMaxAgeInSeconds
        }
      }

      const headers: Record<string, string> = {
        [Headers.gcdnCache]: CacheHitHeader.PASS,
        [Headers.xCache]: CacheHitHeader.PASS,
        [Headers.gcdnScope]: Scope.PUBLIC,
        [Headers.cacheControl]: `public, max-age=${maxAge}, stale-if-error=60, stale-while-revalidate=${maxAge}`,
        ...(injectOriginHeaders ? originHeaders : undefined),
        ...defaultResponseHeaders,
      }

      if (isPrivateAndCacheable) {
        headers[Headers.gcdnScope] = Scope.AUTHENTICATED
        headers[
          Headers.cacheControl
        ] = `private, max-age=${maxAge}, stale-if-error=60, stale-while-revalidate=${maxAge}`
        headers[Headers.vary] =
          'Accept-Encoding, Accept, X-Requested-With, authorization, Origin'
      }

      const result = await save(
        querySignature,
        {
          headers,
          body: results,
        },
        maxAge,
      )

      if (!result) {
        console.error('query could not be stored in cache')
      }

      return res.send(200, results, headers)
    }

    // First call or mutation requests
    return res.send(200, results, {
      ...(injectOriginHeaders ? originHeaders : undefined),
      ...defaultResponseHeaders,
      [Headers.gcdnCache]: CacheHitHeader.PASS,
    })
  }

  // We only understand JSON
  return res.send(
    415,
    {
      error: `Unsupported content-type "${contentType}" from origin "${originUrl}".`,
    },
    {
      ...defaultResponseHeaders,
      [Headers.gcdnCache]: CacheHitHeader.PASS,
    },
  )
}
