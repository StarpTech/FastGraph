import { parse } from 'graphql'
import type { Handler } from 'worktop'
import { SHA256 } from 'worktop/crypto'
import { find, save } from '../stores/QueryCache'

declare const GRAPHQL_URL: string
declare const DEFAULT_TTL: string

const origin = GRAPHQL_URL
const defaultMaxAgeInSeconds = parseInt(DEFAULT_TTL)

export const isMutation = (document: string): boolean => {
  const node = parse(document)
  return node.definitions.some(
    (definition) =>
      definition.kind === 'OperationDefinition' &&
      definition.operation === 'mutation',
  )
}

export const graphql: Handler = async function (req, res) {
  const originalBody = await req.body.json()
  let queryHash
  let isIdempotent

  if (originalBody.query) {
    queryHash = await SHA256(originalBody.query)

    /**
     * Check if we received a query or mutation.
     * Mutations aren't cached.
     */
    try {
      isIdempotent = !isMutation(originalBody.query)
      console.log('Query hash: ' + queryHash)
      console.log('IsIdempotent', isIdempotent)
    } catch (error) {
      return res.send(400, error, {
        'content-type': 'application/json',
        'x-cache': 'MISS',
      })
    }
  }

  /**
   * Check if query is in the cache
   */
  if (queryHash) {
    const cachedQueryResult = await find(queryHash)

    if (cachedQueryResult) {
      return res.send(200, cachedQueryResult, {
        'content-type': 'application/json',
        'x-cache': 'HIT',
      })
    }
  }

  const init = {
    ...req,
    body: JSON.stringify(originalBody),
  }

  /**
   * Refresh content from origin
   */
  const response = await fetch(origin, init)

  const contentType = response.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    const originResult = await response.json()
    const results = JSON.stringify(originResult)
    const maxAgeHeaderValue = response.headers.get('cache-control')

    if (isIdempotent && queryHash) {
      let maxAge = defaultMaxAgeInSeconds
      if (maxAgeHeaderValue) {
        const matches = maxAgeHeaderValue.match(/max-age=(\d+)/)
        maxAge = matches ? parseInt(matches[1]) : defaultMaxAgeInSeconds
      }

      if (maxAge !== -1) {
        await save(queryHash, results, {
          ttl: maxAge,
        })
      }

      return new Response(results, {
        ...response,
        headers: {
          ...response.headers,
          'x-cache': 'MISS',
        },
      })
    }

    return new Response(results, {
      ...response,
      headers: {
        ...response.headers,
        'x-cache': 'MISS',
      },
    })
  }

  return res.send(
    415,
    { error: `Unsupported content-type "${contentType}" from origin.` },
    {
      'content-type': 'application/json',
      'x-cache': 'MISS',
    },
  )
}
