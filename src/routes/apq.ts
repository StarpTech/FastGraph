import type { Handler } from 'worktop'
import { SHA256, timingSafeEqual } from 'worktop/crypto'
import { find, save } from '../stores/APQCache'
import { Headers as HTTPHeaders } from '../utils'

declare const DEFAULT_TTL: string
const defaultMaxAgeInSeconds = parseInt(DEFAULT_TTL)

declare const ORIGIN_URL: string
const originUrl = ORIGIN_URL

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
        timingSafeEqual(
          Buffer.from(await SHA256(query)),
          Buffer.from(persistedQuery.sha256Hash),
        )
      ) {
        return res.send(400, 'provided sha does not match query')
      }
      await save(persistedQuery.sha256Hash, {
        query,
      })
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

  const resp = await fetch(originUrl, {
    body: JSON.stringify({
      query,
    }),
    headers: req.headers,
    method: 'POST',
  })

  const headers: Record<string, string> = {
    [HTTPHeaders.cacheControl]: `public, max-age=${defaultMaxAgeInSeconds}, stale-if-error=60, stale-while-revalidate=${defaultMaxAgeInSeconds}`,
  }

  return res.send(200, await resp.json(), headers)
}
