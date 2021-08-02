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
  Headers as HTTPHeaders,
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
    [HTTPHeaders.contentType]: 'application/json',
    [HTTPHeaders.date]: new Date(Date.now()).toUTCString(),
    [HTTPHeaders.xCache]: CacheHitHeader.MISS,
    [HTTPHeaders.gcdnCache]: CacheHitHeader.MISS,
    [HTTPHeaders.gcdnOriginIgnoreCacheHeaders]: ignoreOriginCacheHeaders
      ? 'true'
      : 'false',
    [HTTPHeaders.xFrameOptions]: 'deny',
    [HTTPHeaders.xRobotsTag]: 'noindex',
    [HTTPHeaders.vary]: 'Accept-Encoding, Accept, X-Requested-With, Origin',

    [HTTPHeaders.contentSecurityPolicy]: `default-src 'none'`,
    [HTTPHeaders.strictTransportSecurity]:
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
    console.log('Rebuild graphql schema')
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
      [HTTPHeaders.gcdnCache]: CacheHitHeader.ERROR,
      [HTTPHeaders.xCache]: CacheHitHeader.HIT,
    })
  }

  const authHeader = req.headers.get(HTTPHeaders.authorization) || ''
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
        [HTTPHeaders.gcdnCache]: CacheHitHeader.HIT,
        [HTTPHeaders.xCache]: CacheHitHeader.HIT,
      }
      if (metadata) {
        const age = Math.round((Date.now() - metadata.createdAt) / 1000)
        headers[HTTPHeaders.age] = (
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
      defaultResponseHeaders[HTTPHeaders.gcdnOriginStatusCode] =
        error.response.status.toString()
      defaultResponseHeaders[HTTPHeaders.gcdnOriginStatusText] =
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

  defaultResponseHeaders[HTTPHeaders.gcdnOriginStatusCode] =
    originResponse.status.toString()
  defaultResponseHeaders[HTTPHeaders.gcdnOriginStatusText] =
    originResponse.statusText.toString()

  const isOriginResponseCacheable =
    isResponseCachable(originResponse) || ignoreOriginCacheHeaders
  const isCacheable =
    (isMutationRequest === false && isOriginResponseCacheable) ||
    (isOriginResponseCacheable && isPrivateAndCacheable)

  const contentType = originResponse.headers.get(HTTPHeaders.contentType)
  const originHeaders = Object.fromEntries(originResponse.headers)

  if (contentType?.includes('application/json')) {
    const originResult = await originResponse.json()

    if (isCacheable) {
      let maxAge = defaultMaxAgeInSeconds
      const maxAgeHeaderValue = originResponse.headers.get(
        HTTPHeaders.cacheControl,
      )
      if (ignoreOriginCacheHeaders === false) {
        if (maxAgeHeaderValue) {
          const parsedMaxAge = parseMaxAge(maxAgeHeaderValue)
          maxAge = parsedMaxAge > -1 ? parsedMaxAge : defaultMaxAgeInSeconds
        }
      }

      const headers: Record<string, string> = {
        [HTTPHeaders.gcdnCache]: CacheHitHeader.PASS,
        [HTTPHeaders.xCache]: CacheHitHeader.PASS,
        [HTTPHeaders.gcdnScope]: Scope.PUBLIC,
        [HTTPHeaders.cacheControl]: `public, max-age=${maxAge}, stale-if-error=60, stale-while-revalidate=${maxAge}`,
        ...(injectOriginHeaders ? originHeaders : undefined),
        ...defaultResponseHeaders,
      }

      if (isPrivateAndCacheable) {
        headers[HTTPHeaders.gcdnScope] = Scope.AUTHENTICATED
        headers[
          HTTPHeaders.cacheControl
        ] = `private, max-age=${maxAge}, stale-if-error=60, stale-while-revalidate=${maxAge}`
        headers[HTTPHeaders.vary] =
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
      [HTTPHeaders.gcdnCache]: CacheHitHeader.PASS,
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
      [HTTPHeaders.gcdnCache]: CacheHitHeader.PASS,
    },
  )
}
