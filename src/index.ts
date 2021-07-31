import { Router, STATUS_CODES } from 'worktop'
import { listen } from 'worktop/cache'
import { graphql } from './routes/graphql'
import { Headers } from './utils'

const API = new Router()

API.add('POST', '/', graphql)

listen(API.run)

API.onerror = (_req, _res, status, error) => {
  const statusText = STATUS_CODES[(status = status || 500)]
  const body = {
    error: (error && error.message) || statusText || String(status),
  }
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: {
      [Headers.cacheControl]: 'application/json',
    },
  })
}
