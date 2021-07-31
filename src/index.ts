import { Router, STATUS_CODES } from 'worktop'
import { listen } from 'worktop/cache'
import * as CORS from 'worktop/cors'
import { fetchAndStoreSchema } from './graphql-utils'
import { graphql } from './routes/graphql'
import { Headers as HTTPHeaders } from './utils'

declare const INTROSPECTION_URL: string

const API = new Router()

API.prepare = CORS.preflight({
  origin: '*', // allow any `Origin` to connect
  headers: ['Cache-Control', 'Content-Type'],
  methods: ['GET', 'HEAD', 'PUT', 'POST', 'DELETE'],
})

API.onerror = (_req, _res, status, error) => {
  const statusText = STATUS_CODES[(status = status || 500)]
  const body = {
    error: (error && error.message) || statusText || String(status),
  }

  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: {
      [HTTPHeaders.contentType]: 'application/json',
    },
  })
}

API.add('POST', '/', graphql)

addEventListener('scheduled', (event) => {
  if (INTROSPECTION_URL) {
    event.waitUntil(fetchAndStoreSchema(INTROSPECTION_URL, new Headers()))
  }
})

listen(API.run)
