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
      query: /* GraphQL */ `
        {
          stationWithEvaId(evaId: 8000105) {
            name
          }
        }
      `,
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
    const originResponse = JSON.stringify(originResponseJson)

    const m = mockFetch(originResponseJson, {
      'content-type': 'application/json',
    }).mock()
    t.teardown(() => m.revert())

    await graphql(req, res)

    t.is(res.statusCode, 200)
    t.deepEqual(res.body, originResponse)

    let headers = Object.fromEntries(res.headers)
    const kvEntries = getKVEntries(KV)
    const metadataEntries = Object.fromEntries(KV_METADATA)

    const graphCDNHeaders = {
      'cache-control':
        'public, max-age=900, stale-if-error=60, stale-while-revalidate=900',
      'content-security-policy': "default-src 'none'",
      'content-type': 'application/json',
      date: 'Fri, 30 Jul 2021 18:46:39 GMT',
      'gcdn-origin-status-code': '200',
      'gcdn-origin-status-text': 'OK',
      'gcdn-origin-ignore-cache-headers': 'false',
      'gcdn-scope': 'PUBLIC',
      'strict-transport-security':
        'max-age=31536000; includeSubdomains; preload',
      vary: 'Accept-Encoding, Accept, X-Requested-With, Origin',
      'x-frame-options': 'deny',
      'x-robots-tag': 'noindex',
    }

    t.deepEqual(headers, {
      ...graphCDNHeaders,
      'gcdn-cache': 'MISS',
      'x-cache': 'MISS',
    })

    t.deepEqual(kvEntries, {
      'query-cache::4f635b8e3af1cd8b0f984720fa72e03acef1e292916227676a96f5ad4141dca7':
        {
          body: originResponseJson,
          headers: {
            ...graphCDNHeaders,
            'gcdn-cache': 'MISS',
            'x-cache': 'MISS',
          },
        },
    })
    t.deepEqual(metadataEntries, {
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

    headers = Object.fromEntries(res.headers)

    t.deepEqual(headers, {
      ...graphCDNHeaders,
      age: '0',
      'gcdn-cache': 'HIT',
      'x-cache': 'HIT',
    })
  },
)

test.serial(
  'Should return 400 when "query" field is missing in body',
  async (t) => {
    let req = WorktopRequest('POST', {})
    let res = WorktopResponse()

    await graphql(req, res)

    t.is(res.statusCode, 400)

    t.deepEqual(res.body, '{"error":"Request has no \\"query\\" field."}')
  },
)

test.serial('Should not cache mutations and proxy them through', async (t) => {
  const KV = new Map()
  const KV_METADATA = new Map()
  createKVNamespaces(['QUERY_CACHE', 'GRAPHQL_SCHEMA'], KV, KV_METADATA)

  let req = WorktopRequest('POST', {
    query: /* GraphQL */ `
      mutation {
        createTodo(item: "foo")
      }
    `,
  })
  let res = WorktopResponse()

  const originResponseJson = {
    data: {
      createTodo: true,
    },
  }
  const originResponse = JSON.stringify(originResponseJson)

  const m = mockFetch(originResponseJson, {
    'content-type': 'application/json',
  }).mock()
  t.teardown(() => m.revert())

  await graphql(req, res)

  t.is(res.statusCode, 200)
  t.deepEqual(res.body, originResponse)

  let headers = Object.fromEntries(res.headers)
  const kvEntries = getKVEntries(KV)
  const metadataEntries = Object.fromEntries(KV_METADATA)

  const graphCDNHeaders = {
    'content-security-policy': "default-src 'none'",
    'content-type': 'application/json',
    date: 'Fri, 30 Jul 2021 18:46:39 GMT',
    'gcdn-origin-status-code': '200',
    'gcdn-origin-status-text': 'OK',
    'gcdn-origin-ignore-cache-headers': 'false',
    'strict-transport-security': 'max-age=31536000; includeSubdomains; preload',
    vary: 'Accept-Encoding, Accept, X-Requested-With, Origin',
    'x-frame-options': 'deny',
    'x-robots-tag': 'noindex',
  }

  t.deepEqual(headers, {
    ...graphCDNHeaders,
    'gcdn-cache': 'PASS',
    'x-cache': 'MISS',
  })

  t.deepEqual(kvEntries, {})
  t.deepEqual(metadataEntries, {})

  await graphql(req, res)
  t.is(res.statusCode, 200)

  headers = Object.fromEntries(res.headers)

  t.deepEqual(headers, {
    ...graphCDNHeaders,
    'gcdn-cache': 'PASS',
    'x-cache': 'MISS',
  })
})

test.serial('Should respect max-age directive from origin', async (t) => {
  const KV = new Map()
  const KV_METADATA = new Map()
  createKVNamespaces(['QUERY_CACHE', 'GRAPHQL_SCHEMA'], KV, KV_METADATA)

  let req = WorktopRequest('POST', {
    query: /* GraphQL */ `
      {
        stationWithEvaId(evaId: 8000105) {
          name
        }
      }
    `,
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
  const originResponse = JSON.stringify(originResponseJson)

  const m = mockFetch(originResponseJson, {
    'content-type': 'application/json',
    'cache-control': 'public, max-age=65',
  }).mock()
  t.teardown(() => m.revert())

  await graphql(req, res)

  t.is(res.statusCode, 200)
  t.deepEqual(res.body, originResponse)

  let headers = Object.fromEntries(res.headers)
  const kvEntries = getKVEntries(KV)
  const metadataEntries = Object.fromEntries(KV_METADATA)

  t.is(
    headers['cache-control'],
    'public, max-age=65, stale-if-error=60, stale-while-revalidate=65',
  )

  t.like(kvEntries, {
    'query-cache::4f635b8e3af1cd8b0f984720fa72e03acef1e292916227676a96f5ad4141dca7':
      {
        body: originResponseJson,
        headers: {
          'cache-control':
            'public, max-age=65, stale-if-error=60, stale-while-revalidate=65',
          'gcdn-cache': 'MISS',
          'x-cache': 'MISS',
        },
      },
  })
  t.deepEqual(metadataEntries, {
    'query-cache::4f635b8e3af1cd8b0f984720fa72e03acef1e292916227676a96f5ad4141dca7':
      {
        expirationTtl: 65,
        metadata: {
          createdAt: 1627670799330,
          expirationTtl: 65,
        },
        toJSON: true,
      },
  })

  await graphql(req, res)
  t.is(res.statusCode, 200)

  headers = Object.fromEntries(res.headers)

  t.like(headers, {
    'cache-control':
      'public, max-age=65, stale-if-error=60, stale-while-revalidate=65',
    age: '0',
    'gcdn-cache': 'HIT',
    'x-cache': 'HIT',
  })
})

test.serial(
  'Should fail when origin does not respond with propert json content-type',
  async (t) => {
    const KV = new Map()
    const KV_METADATA = new Map()
    createKVNamespaces(['QUERY_CACHE', 'GRAPHQL_SCHEMA'], KV, KV_METADATA)

    let req = WorktopRequest('POST', {
      query: /* GraphQL */ `
        {
          stationWithEvaId(evaId: 8000105) {
            name
          }
        }
      `,
    })
    let res = WorktopResponse()

    const originResponseJson = {}
    const m = mockFetch(originResponseJson, {
      'content-type': 'text/html',
    }).mock()
    t.teardown(() => m.revert())

    await graphql(req, res)

    t.is(res.statusCode, 415)
    t.deepEqual(
      res.body,
      '{"error":"Unsupported content-type \\"text/html\\" from origin \\"https://grapql-endpoint/\\"."}',
    )
  },
)
