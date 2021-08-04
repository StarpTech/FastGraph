import type { Handler } from 'worktop'
import { SHA256, timingSafeEqual } from 'worktop/crypto'
import { encode } from 'worktop/utils'
import { find, save } from '../stores/APQCache'
import { Headers as HTTPHeaders } from '../utils'
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

  const authorizationHeader = req.headers.get(HTTPHeaders.authorization)

  const cacheUrl = new URL(req.url)
  let pathname = cacheUrl.pathname

  // append "authorization" value to query and make it part of the cache key
  if (authorizationHeader) {
    cacheUrl.searchParams.append(
      HTTPHeaders.authorization,
      await SHA256(authorizationHeader),
    )
  }

  // sort params to avoid cache fragmentation
  cacheUrl.searchParams.sort()

  cacheUrl.pathname = pathname

  const cacheKey = new Request(cacheUrl.toString(), {
    headers: req.headers,
    method: 'GET',
  })

  const cache = caches.default

  let response = await cache.match(cacheKey)

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

  let operationName = req.query.get('operationName')
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
  if (!originResponse.ok) {
    return res.send(
      originResponse.status,
      {
        error: `fetch error: ${originResponse.statusText}`,
      },
      {
        [HTTPHeaders.cacheControl]: 'public, no-cache',
      },
    )
  }

  let json = await originResponse.json()

  if (json?.errors) {
    return res.send(500, json?.errors, {
      [HTTPHeaders.cacheControl]: 'public, no-cache',
    })
  }

  const ignoreOriginCacheHeaders = IGNORE_ORIGIN_CACHE_HEADERS === '1'
  const cacheControlHeader = originResponse.headers.get(
    HTTPHeaders.cacheControl,
  )

  let cacheMaxAge = APQ_TTL
  const headers: Record<string, string> = {
    [HTTPHeaders.cacheControl]: `public, max-age=${cacheMaxAge}, stale-if-error=${swr}, stale-while-revalidate=${swr}`,
    [HTTPHeaders.contentType]: 'application/json',
    [HTTPHeaders.fgOriginStatusCode]: originResponse.status.toString(),
    [HTTPHeaders.fgOriginStatusText]: originResponse.statusText.toString(),
  }

  if (ignoreOriginCacheHeaders === false && cacheControlHeader) {
    headers[HTTPHeaders.cacheControl] = cacheControlHeader
  }

  // Alias for `event.waitUntil`
  // ~> queues background task (does NOT delay response)
  req.extend(
    cache.put(
      cacheKey,
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
