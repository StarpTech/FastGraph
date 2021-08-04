import { Router, STATUS_CODES, listen } from 'worktop'
import * as CORS from 'worktop/cors'
import { apq } from './routes/apq'
import { graphql } from './routes/graphql'
import { Headers as HTTPHeaders } from './utils'

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
      [HTTPHeaders.cacheControl]: 'public, no-cache',
      [HTTPHeaders.contentType]: 'application/json',
    },
  })
}

API.add('POST', '/', graphql)
API.add('GET', '/', apq)

// Attach "fetch" event handler
// ~> use `Cache` for request-matching, when permitted
// ~> store Response in `Cache`, when permitted
listen(API.run)
