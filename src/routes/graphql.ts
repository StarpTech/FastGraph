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
} from '../utils'
import { find, save } from '../stores/QueryCache'
import { latest } from '../stores/Schema'
import { parse } from 'graphql'
import { HTTPResponseError } from '../errors'

declare const GRAPHQL_URL: string
declare const DEFAULT_TTL: string
declare const PRIVATE_TYPES: string

const origin = GRAPHQL_URL
const defaultMaxAgeInSeconds = parseInt(DEFAULT_TTL)
const privateTypes = PRIVATE_TYPES.split(',')

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
    [Headers.date]: new Date(Date.now()).toUTCString(),
    [Headers.accessControlMaxAge]: '300',
    [Headers.xCache]: CacheHitHeader.MISS,
    [Headers.gcdnCache]: CacheHitHeader.MISS,
  }

  const queryDocumentNode = parse(originalBody.query, { noLocation: true })
  let hasPrivateTypes = false
  let isMutationRequest = false
  let content = undefined

  try {
    const schema = await latest()

    if (schema && privateTypes.length > 0) {
      hasPrivateTypes = hasIntersectedTypes(
        schema,
        queryDocumentNode,
        privateTypes,
      )
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
  const isPrivateAndCacheable = isMutationRequest === false && hasPrivateTypes
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
  let originResponse = await retry(
    async () => {
      const resp = await fetch(origin, {
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

  const isCacheable =
    (isMutationRequest === false && isResponseCachable(originResponse)) ||
    isPrivateAndCacheable

  const contentType = originResponse.headers.get(Headers.contentType)
  const originHeaders = Object.fromEntries(originResponse.headers)

  if (contentType?.includes('application/json')) {
    const originResult = await originResponse.json()
    const results = JSON.stringify(originResult)
    const maxAgeHeaderValue = originResponse.headers.get(Headers.cacheControl)

    if (isCacheable) {
      let maxAge = defaultMaxAgeInSeconds
      if (maxAgeHeaderValue) {
        const parsedMaxAge = parseMaxAge(maxAgeHeaderValue)
        maxAge = parsedMaxAge > -1 ? parsedMaxAge : defaultMaxAgeInSeconds
      }

      const headers: Record<string, string> = {
        [Headers.gcdnCache]: CacheHitHeader.PASS,
        [Headers.xCache]: CacheHitHeader.PASS,
        ...originHeaders,
        ...defaultResponseHeaders,
      }

      if (isPrivateAndCacheable) {
        headers[
          Headers.cacheControl
        ] = `private, max-age=${maxAge}, stale-while-revalidate=${maxAge}`
      } else {
        headers[
          Headers.cacheControl
        ] = `public, max-age=${maxAge}, stale-while-revalidate=${maxAge}`
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
      ...originHeaders,
      ...defaultResponseHeaders,
      [Headers.gcdnCache]: CacheHitHeader.PASS,
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
