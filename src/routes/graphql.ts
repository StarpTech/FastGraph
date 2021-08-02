import type { Handler } from 'worktop'
import { SHA256 } from 'worktop/crypto'
import retry from 'async-retry'
import LZUTF8 from 'lzutf8'
import {
  normalizeDocument,
  isMutation,
  hasIntersectedTypes,
  requiresAuth,
  buildGraphQLSchema,
} from '../graphql-utils'
import {
  Headers,
  CacheHitHeader,
  isResponseCachable,
  parseMaxAge,
  Scope,
} from '../utils'
import { find, save } from '../stores/QueryCache'
import { HTTPResponseError } from '../errors'
import { GraphQLSchema, parse } from 'graphql'

declare const ORIGIN_URL: string
declare const DEFAULT_TTL: string
declare const PRIVATE_TYPES: string
declare const INJECT_ORIGIN_HEADERS: string
declare const SCOPE: string
declare const IGNORE_ORIGIN_CACHE_HEADERS: string
declare const AUTH_DIRECTIVE: string

const originUrl = ORIGIN_URL
const defaultMaxAgeInSeconds = parseInt(DEFAULT_TTL)
const privateTypes = PRIVATE_TYPES ? PRIVATE_TYPES.split(',') : null
const injectOriginHeaders = !!INJECT_ORIGIN_HEADERS
const scope: Scope = SCOPE as Scope
const ignoreOriginCacheHeaders = !!IGNORE_ORIGIN_CACHE_HEADERS
const authDirectiveName = AUTH_DIRECTIVE

// webpack
declare const SCHEMA_STRING: string
let schemaString = LZUTF8.decompress(SCHEMA_STRING, {
  inputEncoding: 'StorageBinaryString',
})
let schema: GraphQLSchema

type GraphQLRequest = {
  query: string
  operationName?: string
  variables?: Record<string, any>
  // only for testing
  schema?: string
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

  let queryDocumentNode = null
  let hasPrivateTypes = false
  let isMutationRequest = false
  let authRequired = false
  let content = originalBody.query

  // only for testing
  if (process.env.NODE_ENV === 'test' && originalBody.schema) {
    schema = buildGraphQLSchema(originalBody.schema)
  } else if (!schema && schemaString) {
    schema = buildGraphQLSchema(schemaString)
  }

  try {
    queryDocumentNode = parse(originalBody.query, { noLocation: true })
    isMutationRequest = isMutation(queryDocumentNode)

    if (!isMutationRequest) {
      if (authDirectiveName || privateTypes) {
        if (schema) {
          if (authDirectiveName) {
            authRequired = requiresAuth(
              authDirectiveName,
              schema,
              queryDocumentNode,
            )
          }
          if (privateTypes) {
            hasPrivateTypes = hasIntersectedTypes(
              schema,
              queryDocumentNode,
              privateTypes,
            )
          }
        }
      }

      content = normalizeDocument(originalBody.query)
    }
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
    (hasPrivateTypes || scope === Scope.AUTHENTICATED || authRequired)

  /**
   *  In case of the query will return user specific data the response
   *  is cached user specific based on the Authorization header
   */
  let querySignature = ''
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
        ...defaultResponseHeaders,
        ...value.headers,
        ...headers,
      })
    }
  }

  /**
   * Refresh content from origin
   * In case of an error we will retry
   */
  let originResponse = null

  try {
    const body = JSON.stringify(originalBody)
    originResponse = await retry(
      async () => {
        const resp = await fetch(originUrl, {
          body,
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
        unref: true,
        maxTimeout: 1000,
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
    // will call the onerror handler
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
          body: originResult,
        },
        maxAge,
      )

      if (!result) {
        console.error('query could not be stored in cache')
      }

      return res.send(200, originResult, headers)
    }

    // First call or mutation requests
    return res.send(200, originResult, {
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
