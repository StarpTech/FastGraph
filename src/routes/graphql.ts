import { Handler } from 'worktop'
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
declare const SCOPE: string
declare const IGNORE_ORIGIN_CACHE_HEADERS: string
declare const AUTH_DIRECTIVE: string
declare const SWR: string
declare const SCHEMA_STRING: string

const originUrl = ORIGIN_URL
const defaultMaxAgeInSeconds = parseInt(DEFAULT_TTL)
const swr = parseInt(SWR)
const privateTypes = PRIVATE_TYPES ? PRIVATE_TYPES.split(',') : null
const scope: Scope = SCOPE as Scope
const authDirectiveName = AUTH_DIRECTIVE

/**
 * Only one Workers instance runs on each of the many global Cloudflare edge servers.
 * Each Workers instance can consume up to 128MB of memory.
 * Use global variables to persist data between requests on individual nodes;
 * note however, that nodes are occasionally evicted from memory.
 * https://developers.cloudflare.com/workers/platform/limits#memory
 *
 * This means that the graphql schema is cached for the second request on every edge server
 * but may be rebuild when the worker is exited due to memory limit.
 */
let schemaString = LZUTF8.decompress(SCHEMA_STRING, {
  inputEncoding: 'StorageBinaryString',
})
let schema: GraphQLSchema

export type GraphQLRequest = {
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

  const ignoreOriginCacheHeaders = IGNORE_ORIGIN_CACHE_HEADERS === '1'

  const defaultResponseHeaders: Record<string, string> = {
    [HTTPHeaders.contentType]: 'application/json',
    [HTTPHeaders.date]: new Date(Date.now()).toUTCString(),
    [HTTPHeaders.xCache]: CacheHitHeader.MISS,
    [HTTPHeaders.fgCache]: CacheHitHeader.MISS,
    [HTTPHeaders.fgOriginIgnoreCacheHeaders]: ignoreOriginCacheHeaders
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
      [HTTPHeaders.fgCache]: CacheHitHeader.ERROR,
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
        [HTTPHeaders.fgCache]: CacheHitHeader.HIT,
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
      defaultResponseHeaders[HTTPHeaders.fgOriginStatusCode] =
        error.response.status.toString()
      defaultResponseHeaders[HTTPHeaders.fgOriginStatusText] =
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

  defaultResponseHeaders[HTTPHeaders.fgOriginStatusCode] =
    originResponse.status.toString()
  defaultResponseHeaders[HTTPHeaders.fgOriginStatusText] =
    originResponse.statusText.toString()

  const isOriginResponseCacheable =
    isResponseCachable(originResponse) || ignoreOriginCacheHeaders
  const isCacheable =
    (isMutationRequest === false && isOriginResponseCacheable) ||
    (isOriginResponseCacheable && isPrivateAndCacheable)

  const contentType = originResponse.headers.get(HTTPHeaders.contentType)

  if (contentType?.includes('application/json')) {
    const originResult = await originResponse.json()

    if (isCacheable) {
      const headers: Record<string, string> = {
        [HTTPHeaders.fgCache]: CacheHitHeader.PASS,
        [HTTPHeaders.xCache]: CacheHitHeader.PASS,
        [HTTPHeaders.fgScope]: Scope.PUBLIC,
        [HTTPHeaders.cacheControl]: `public, max-age=${defaultMaxAgeInSeconds}, stale-if-error=60, stale-while-revalidate=${swr}`,
        ...defaultResponseHeaders,
      }

      const cacheControlHeader = originResponse.headers.get(
        HTTPHeaders.cacheControl,
      )
      let cacheMaxAge = defaultMaxAgeInSeconds

      if (isPrivateAndCacheable) {
        headers[HTTPHeaders.fgScope] = Scope.AUTHENTICATED
        headers[
          HTTPHeaders.cacheControl
        ] = `private, max-age=${defaultMaxAgeInSeconds}, stale-if-error=60, stale-while-revalidate=${swr}`
        headers[HTTPHeaders.vary] =
          'Accept-Encoding, Accept, X-Requested-With, authorization, Origin'
      } else if (ignoreOriginCacheHeaders === false && cacheControlHeader) {
        headers[HTTPHeaders.cacheControl] = cacheControlHeader
        const parsedMaxAge = parseMaxAge(cacheControlHeader)
        cacheMaxAge = parsedMaxAge > -1 ? parsedMaxAge : defaultMaxAgeInSeconds
      }

      // Alias for `event.waitUntil`
      // ~> queues background task (does NOT delay response)
      req.extend(
        save(
          querySignature,
          {
            headers,
            body: originResult,
          },
          cacheMaxAge,
        ),
      )

      return res.send(200, originResult, headers)
    }

    // First call or mutation requests
    return res.send(200, originResult, {
      ...defaultResponseHeaders,
      [HTTPHeaders.fgCache]: CacheHitHeader.PASS,
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
      [HTTPHeaders.fgCache]: CacheHitHeader.PASS,
    },
  )
}
