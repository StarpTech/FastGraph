import type { Handler } from 'worktop'
import { SHA256, timingSafeEqual } from 'worktop/crypto'
import { isCacheable } from 'worktop/cache'
import { find, save } from '../stores/APQCache'
import { CacheHitHeader, Headers as HTTPHeaders, parseMaxAge } from '../utils'
import { HTTPResponseError } from '../errors'

declare const DEFAULT_TTL: string
const defaultMaxAgeInSeconds = parseInt(DEFAULT_TTL)

declare const APQ_TTL: string
const defaultAPQTTL = parseInt(APQ_TTL)

declare const ORIGIN_URL: string
const originUrl = ORIGIN_URL

declare const SWR: string
const swr = parseInt(SWR)

type APQExtensions = {
  persistedQuery: {
    version: number
    sha256Hash: string
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
  let query = req.query.get('query')

  const result = await find(persistedQuery.sha256Hash)
  if (result) {
    query = result.query
  }

  if (!result) {
    if (query) {
      if (
        !timingSafeEqual(
          Buffer.from(await SHA256(query)),
          Buffer.from(persistedQuery.sha256Hash),
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

  const originResponse = await fetch(originUrl, {
    body: JSON.stringify({
      query,
    }),
    headers: req.headers,
    method: 'POST',
  })

  if (!originResponse.ok) {
    throw new HTTPResponseError(originResponse)
  }

  let maxAge = defaultMaxAgeInSeconds
  const maxAgeHeaderValue = originResponse.headers.get(HTTPHeaders.cacheControl)

  if (maxAgeHeaderValue) {
    const parsedMaxAge = parseMaxAge(maxAgeHeaderValue)
    maxAge = parsedMaxAge > -1 ? parsedMaxAge : defaultMaxAgeInSeconds
  }

  const headers: Record<string, string> = {
    [HTTPHeaders.contentType]: 'application/json',
    [HTTPHeaders.cacheControl]: `public, max-age=${maxAge}, stale-if-error=60, stale-while-revalidate=${swr}`,
    [HTTPHeaders.gcdnOriginStatusCode]: originResponse.status.toString(),
    [HTTPHeaders.gcdnOriginStatusText]: originResponse.statusText.toString(),
    [HTTPHeaders.gcdnCache]: isCacheable(originResponse)
      ? CacheHitHeader.HIT
      : CacheHitHeader.MISS,
  }

  return res.send(200, await originResponse.json(), headers)
}
