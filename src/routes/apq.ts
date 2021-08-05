import type { Handler } from 'worktop'
import { SHA256, timingSafeEqual } from 'worktop/crypto'
import { encode } from 'worktop/utils'
import { find, save } from '../stores/APQCache'
import { Headers as HTTPHeaders, Scope } from '../utils'
import { GraphQLRequest } from './graphql'

declare const APQ_TTL: string
const defaultAPQTTL = parseInt(APQ_TTL)

declare const ORIGIN_URL: string
const originUrl = ORIGIN_URL

declare const SWR: string
const swr = parseInt(SWR)

declare const IGNORE_ORIGIN_CACHE_HEADERS: string

type APQExtensions = {
  persistedQuery: {
    version: number
    sha256Hash: string
    variables?: Record<string, number | string>
  }
}

export const apq: Handler = async function (req, res) {
  const extensionsRawJson = req.query.get('extensions')

  if (!extensionsRawJson) {
    return res.send(400, {
      error: 'Invalid APQ request',
    })
  }

  const { persistedQuery } = JSON.parse(extensionsRawJson) as APQExtensions

  if (persistedQuery.version !== 1) {
    return res.send(400, 'Unsupported persisted query version')
  }

  const headers: Record<string, string> = {
    [HTTPHeaders.fgScope]: Scope.PUBLIC,
  }

  const operationName = req.query.get('operationName')
  const authorizationHeader = req.headers.get(HTTPHeaders.authorization)

  const cacheUrl = new URL(req.url)
  let cacheKey = ''

  if (operationName) {
    cacheKey += operationName
  }

  // append "authorization" value to query and make it part of the cache key
  if (authorizationHeader) {
    headers[HTTPHeaders.fgScope] = Scope.AUTHENTICATED
    cacheKey += operationName ? '/' : '' + (await SHA256(authorizationHeader))
  }

  cacheUrl.pathname = cacheUrl.pathname + cacheKey

  const cacheRequest = new Request(cacheUrl.toString(), {
    headers: req.headers,
    method: 'GET',
  })

  const cache = caches.default

  let response = await cache.match(cacheRequest)

  if (response) {
    return response
  }

  let query = req.query.get('query')

  const result = await find(persistedQuery.sha256Hash)
  if (result) {
    query = result.query
  }

  // if query could not be found in cache, we will assume
  // the next action is to register the APQ
  if (!result) {
    // check if APQ hash is matching with the query hash
    if (query) {
      if (
        !timingSafeEqual(
          encode(await SHA256(query)),
          encode(persistedQuery.sha256Hash),
        )
      ) {
        return res.send(400, 'provided sha does not match query')
      }
      // Alias for `event.waitUntil`
      // ~> queues background task (does NOT delay response)
      req.extend(
        save(
          persistedQuery.sha256Hash,
          {
            query,
          },
          defaultAPQTTL,
        ),
      )
    } else {
      // when APQ could not be found the client must retry with the original query
      return res.send(200, {
        data: {
          errors: [
            {
              extensions: {
                code: 'PERSISTED_QUERY_NOT_FOUND',
              },
            },
          ],
        },
      })
    }
  }

  let variables = req.query.get('variables')

  const q = query!
  const body: GraphQLRequest = { query: q }

  if (operationName) {
    body.operationName = operationName
  }
  if (variables) {
    body.variables = JSON.parse(variables)
  }

  let originResponse = await fetch(originUrl, {
    body: JSON.stringify(body),
    headers: req.headers,
    method: 'POST',
  })

  // don't cache origin errors
  if (!originResponse.ok) {
    return res.send(
      originResponse.status,
      {
        error: `fetch error: ${originResponse.statusText}`,
      },
      {
        [HTTPHeaders.cacheControl]: 'public, no-cache, no-store',
      },
    )
  }

  let json = await originResponse.json()

  // don't cache graphql errors
  if (json?.errors) {
    return res.send(500, json?.errors, {
      [HTTPHeaders.cacheControl]: 'public, no-cache, no-store',
    })
  }

  const ignoreOriginCacheHeaders = IGNORE_ORIGIN_CACHE_HEADERS === '1'
  const cacheControlHeader = originResponse.headers.get(
    HTTPHeaders.cacheControl,
  )

  let cacheMaxAge = APQ_TTL

  headers[
    HTTPHeaders.cacheControl
  ] = `public, max-age=${cacheMaxAge}, stale-if-error=${swr}, stale-while-revalidate=${swr}`
  headers[HTTPHeaders.contentType] = 'application/json'
  headers[HTTPHeaders.fgOriginStatusCode] = originResponse.status.toString()
  headers[HTTPHeaders.fgOriginStatusText] = originResponse.statusText.toString()

  const cacheTags = [persistedQuery.sha256Hash]

  // You can purge your cache by tags
  // This is only evaluated on enterprise plan and the header is never visible for customers
  if (operationName) {
    cacheTags.push(operationName)
  }
  headers[HTTPHeaders.cfCacheTag] = cacheTags.join(',')

  if (ignoreOriginCacheHeaders === false && cacheControlHeader) {
    headers[HTTPHeaders.cacheControl] = cacheControlHeader
  }

  // Alias for `event.waitUntil`
  // ~> queues background task (does NOT delay response)
  req.extend(
    cache.put(
      cacheRequest,
      new Response(json, {
        status: originResponse.status,
        statusText: originResponse.statusText,
        headers: {
          ...headers,
        },
      }),
    ),
  )

  return res.send(200, json, headers)
}
