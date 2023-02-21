import { Handler } from 'worktop'
import { SHA256 } from 'worktop/crypto'
import retry from 'async-retry'
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
  Scope,
} from '../utils'
import { find as findSchema } from '../stores/Schema'
import { HTTPResponseError } from '../errors'
import { GraphQLSchema, parse } from 'graphql'

declare const ORIGIN_URL: string
declare const DEFAULT_TTL: string
declare const PRIVATE_TYPES: string
declare const SCOPE: string
declare const IGNORE_ORIGIN_CACHE_HEADERS: string
declare const AUTH_DIRECTIVE: string
declare const SWR: string

const originUrl = ORIGIN_URL
const defaultMaxAgeInSeconds = parseInt(DEFAULT_TTL)
const swr = parseInt(SWR)
const privateTypes = PRIVATE_TYPES ? PRIVATE_TYPES.split(',') : null
const scope: Scope = SCOPE as Scope

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
let graphQLSchema: GraphQLSchema

export type GraphQLRequest = {
  query: string
  operationName?: string
  variables?: Record<string, any>
}

export const graphql: Handler = async function (req, res) {
  const originalBody = await req.body.json<GraphQLRequest>()
  const variables = JSON.stringify(originalBody.variables)
  if (!originalBody.query) {
    return res.send(400, {
      error: 'Request has no "query" field.',
    })
  }

  const ignoreOriginCacheHeaders = IGNORE_ORIGIN_CACHE_HEADERS === '1'
  const authorizationHeader = req.headers.get(HTTPHeaders.authorization) || ''

  const defaultResponseHeaders: Record<string, string> = {
    [HTTPHeaders.contentType]: 'application/json',
    [HTTPHeaders.cacheControl]: 'public, no-cache, no-store',
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
  let inspectSchema = !!AUTH_DIRECTIVE || !!privateTypes

  try {
    queryDocumentNode = parse(originalBody.query, { noLocation: true })
    isMutationRequest = isMutation(queryDocumentNode)

    if (!isMutationRequest) {
      content = normalizeDocument(originalBody.query)

      if (inspectSchema) {
        const schema = await findSchema()
        if (schema && !graphQLSchema) {
          graphQLSchema = buildGraphQLSchema(schema)
        }

        if (graphQLSchema) {
          defaultResponseHeaders[HTTPHeaders.fgInspected] = 'true'
          if (AUTH_DIRECTIVE) {
            authRequired = requiresAuth(
              AUTH_DIRECTIVE,
              graphQLSchema,
              queryDocumentNode,
            )
          }
          if (privateTypes) {
            hasPrivateTypes = hasIntersectedTypes(
              graphQLSchema,
              queryDocumentNode,
              privateTypes,
            )
          }
        }
      }
    }
  } catch (error) {
    console.error(error)

    return res.send(400, error, {
      ...defaultResponseHeaders,
      [HTTPHeaders.fgCache]: CacheHitHeader.ERROR,
      [HTTPHeaders.xCache]: CacheHitHeader.HIT,
    })
  }

  const isPrivateAndCacheable =
    isMutationRequest === false &&
    (hasPrivateTypes || scope === Scope.AUTHENTICATED || authRequired)

  
  /**
   *  In case of the query will return user specific data the response
   *  is cached user specific based on the Authorization header
   */
  const cache = caches.default
  let querySignature = ''
  let cacheRequest: Request | null = null

  /**
   * Check if query is in the cache
   */
  if (isMutationRequest === false) {
    let cacheKey = ''

    if (isPrivateAndCacheable) {
        querySignature = await SHA256(authorizationHeader + content + variables)
        defaultResponseHeaders[HTTPHeaders.fgScope] = Scope.AUTHENTICATED
    } else {
        querySignature = await SHA256(content + variables)
    }
    
    const cacheUrl = new URL(req.url)

    if (originalBody.operationName) {
      cacheKey += originalBody.operationName + '/'
    }

    cacheKey += querySignature

    cacheUrl.pathname = cacheUrl.pathname + cacheKey
    cacheRequest = new Request(cacheUrl.toString(), {
      headers: req.headers,
      method: 'GET',
    })

    let response = await cache.match(cacheRequest)

    if (response) {
      return response
    }
  }

  /**
   * Refresh content from origin
   * In case of an error we will retry
   */
  let originResponse = null

  try {
    const forwardedHeaders = new Headers()
    forwardedHeaders.append(HTTPHeaders.contentType, 'application/json')
  
    if (authorizationHeader) {
      forwardedHeaders.append(HTTPHeaders.authorization, authorizationHeader)
    }

    const body = JSON.stringify(originalBody)
    originResponse = await retry(
      async () => {
        const resp = await fetch(originUrl, {
          body,
          headers: forwardedHeaders,
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
    console.error(error)

    if (error instanceof HTTPResponseError) {
      defaultResponseHeaders[HTTPHeaders.fgOriginStatusCode] =
        error.response.status.toString()
      defaultResponseHeaders[HTTPHeaders.fgOriginStatusText] =
        error.response.statusText.toString()
      return res.send(
        500,
        {
          name: 'OriginError',
          error: 'Could not call origin',
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
        ...defaultResponseHeaders,
        [HTTPHeaders.cacheControl]: `public, max-age=${defaultMaxAgeInSeconds}, stale-if-error=${swr}, stale-while-revalidate=${swr}`,
      }

      if (isPrivateAndCacheable) {
        headers[HTTPHeaders.fgScope] = Scope.AUTHENTICATED
        headers[
          HTTPHeaders.cacheControl
        ] = `public, max-age=${defaultMaxAgeInSeconds}, stale-if-error=${swr}, stale-while-revalidate=${swr}`
        headers[HTTPHeaders.vary] =
          'Accept-Encoding, Accept, X-Requested-With, authorization, Origin'
      } else if (ignoreOriginCacheHeaders === false) {
        // supported cache headers
        // https://developers.cloudflare.com/workers/runtime-apis/cache#headers
        const cacheControlHeader = originResponse.headers.get(
          HTTPHeaders.cacheControl,
        )
        if (cacheControlHeader) {
          headers[HTTPHeaders.cacheControl] = cacheControlHeader
        }
        const etag = originResponse.headers.get(HTTPHeaders.etag)
        if (etag) {
          headers[HTTPHeaders.etag] = etag
        }
        const expires = originResponse.headers.get(HTTPHeaders.expires)
        if (expires) {
          headers[HTTPHeaders.expires] = expires
        }
        const lastModified = originResponse.headers.get(
          HTTPHeaders.lastModified,
        )
        if (lastModified) {
          headers[HTTPHeaders.lastModified] = lastModified
        }
      }

      if (cacheRequest) {
        // You can purge your cache by tags
        // This is only evaluated on enterprise plan and the header is never visible for customers
        const cacheTags = [querySignature]
        if (originalBody.operationName) {
          cacheTags.push(originalBody.operationName)
        }

        if (ignoreOriginCacheHeaders === false) {
          const cacheTag = originResponse.headers.get(HTTPHeaders.cfCacheTag)
          if (cacheTag) {
            cacheTags.push(...cacheTag.split(','))
          }
        }

        // Alias for `event.waitUntil`
        // ~> queues background task (does NOT delay response)
        req.extend(
          cache.put(
            cacheRequest,
            new Response(JSON.stringify(originResult), {
              status: originResponse.status,
              statusText: originResponse.statusText,
              headers: {
                ...headers,
                [HTTPHeaders.fgCache]: CacheHitHeader.HIT,
                [HTTPHeaders.xCache]: CacheHitHeader.HIT,
                [HTTPHeaders.cfCacheTag]: cacheTags.join(','),
              },
            }),
          ),
        )
      }
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
      name: 'UnsupportedOriginContentType',
      error: `Unsupported content-type "${contentType}" from origin "${originUrl}".`,
    },
    {
      ...defaultResponseHeaders,
      [HTTPHeaders.fgCache]: CacheHitHeader.PASS,
    },
  )
}
