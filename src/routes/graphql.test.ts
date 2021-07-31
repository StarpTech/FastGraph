import test from 'ava'
import {
  createKVNamespaces,
  getKVEntries,
  mockFetch,
  WorktopRequest,
  WorktopResponse,
} from '../test-utils'
import { graphql } from './graphql'

test.serial(
  'Should call origin and cache on subsequent requests',
  async (t) => {
    const KV = new Map()
    const KV_METADATA = new Map()
    createKVNamespaces(['QUERY_CACHE', 'GRAPHQL_SCHEMA'], KV, KV_METADATA)

    let req = WorktopRequest('POST', {
      query: '{ stationWithEvaId(evaId: 8000105) { name } }',
    })
    let res = WorktopResponse()

    const originResponseJson = {
      data: {
        stationWithEvaId: {
          name: 'Frankfurt (Main) Hbf',
          location: {
            latitude: 50.107145,
            longitude: 8.663789,
          },
          picture: {
            url: 'https://api.railway-stations.org/photos/de/1866.jpg',
          },
        },
      },
    }

    const m = mockFetch(originResponseJson, {
      'content-type': 'application/json',
    }).mock()
    t.teardown(() => m.revert())

    await graphql(req, res)

    t.is(res.statusCode, 200)
    t.deepEqual(res.body, JSON.stringify(originResponseJson))

    t.deepEqual(Object.fromEntries(res.headers), {
      'cache-control':
        'public, max-age=900, stale-if-error=60, stale-while-revalidate=900',
      'content-security-policy': "default-src 'none'",
      'content-type': 'application/json',
      date: 'Fri, 30 Jul 2021 18:46:39 GMT',
      'gcdn-cache': 'MISS',
      'gcdn-origin-status-code': '200',
      'gcdn-origin-status-text': 'OK',
      'strict-transport-security':
        'max-age=31536000; includeSubdomains; preload',
      vary: 'Accept-Encoding, Accept, X-Requested-With, Origin',
      'x-cache': 'MISS',
      'x-frame-options': 'deny',
      'x-robots-tag': 'noindex',
    })

    t.deepEqual(getKVEntries(KV), {
      'query-cache::4f635b8e3af1cd8b0f984720fa72e03acef1e292916227676a96f5ad4141dca7':
        {
          body: JSON.stringify(originResponseJson),
          headers: {
            'cache-control':
              'public, max-age=900, stale-if-error=60, stale-while-revalidate=900',
            'content-security-policy': "default-src 'none'",
            'content-type': 'application/json',
            date: 'Fri, 30 Jul 2021 18:46:39 GMT',
            'gcdn-cache': 'MISS',
            'gcdn-origin-status-code': '200',
            'gcdn-origin-status-text': 'OK',
            'strict-transport-security':
              'max-age=31536000; includeSubdomains; preload',
            vary: 'Accept-Encoding, Accept, X-Requested-With, Origin',
            'x-cache': 'MISS',
            'x-frame-options': 'deny',
            'x-robots-tag': 'noindex',
          },
        },
    })
    t.deepEqual(Object.fromEntries(KV_METADATA), {
      'query-cache::4f635b8e3af1cd8b0f984720fa72e03acef1e292916227676a96f5ad4141dca7':
        {
          expirationTtl: 900,
          metadata: {
            createdAt: 1627670799330,
            expirationTtl: 900,
          },
          toJSON: true,
        },
    })

    await graphql(req, res)
    t.is(res.statusCode, 200)

    t.deepEqual(Object.fromEntries(res.headers), {
      age: '0',
      'cache-control':
        'public, max-age=900, stale-if-error=60, stale-while-revalidate=900',
      'content-security-policy': "default-src 'none'",
      'content-type': 'application/json',
      date: 'Fri, 30 Jul 2021 18:46:39 GMT',
      'gcdn-cache': 'HIT',
      'gcdn-origin-status-code': '200',
      'gcdn-origin-status-text': 'OK',
      'strict-transport-security':
        'max-age=31536000; includeSubdomains; preload',
      vary: 'Accept-Encoding, Accept, X-Requested-With, Origin',
      'x-cache': 'HIT',
      'x-frame-options': 'deny',
      'x-robots-tag': 'noindex',
    })
  },
)
