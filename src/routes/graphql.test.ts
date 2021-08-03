import test from 'ava'
import { readFileSync } from 'fs'
import {
  getKVEntries,
  mockFetch,
  NewKVNamespace,
  WorktopRequest,
  WorktopResponse,
} from '../test-utils'
import { CacheHitHeader, Headers, Scope } from '../utils'
import { graphql } from './graphql'

const testSchema = readFileSync('./testdata/star_wars.graphql', 'utf8')
const droidWithArg = readFileSync(
  './testdata/queries/droid_with_arg.graphql',
  'utf8',
)
const createReview = readFileSync(
  './testdata/mutations/create_review.graphql',
  'utf8',
)
const simpleHero = readFileSync(
  './testdata/queries/simple_hero.graphql',
  'utf8',
)

test.serial(
  'Should call origin and cache on subsequent requests',
  async (t) => {
    const { store: queryStore, metadata } = NewKVNamespace({
      name: 'QUERY_CACHE',
    })

    let req = WorktopRequest('POST', {
      query: droidWithArg,
    })
    let res = WorktopResponse()

    const originResponseJson = {
      data: {
        droid: {
          name: 'R2-D2',
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
    const kvEntries = getKVEntries(queryStore)
    const metadataEntries = Object.fromEntries(metadata)

    const fastGraphHeaders = {
      [Headers.cacheControl]:
        'public, max-age=900, stale-if-error=60, stale-while-revalidate=900',
      [Headers.contentSecurityPolicy]: "default-src 'none'",
      [Headers.contentType]: 'application/json',
      [Headers.date]: 'Fri, 30 Jul 2021 18:46:39 GMT',
      [Headers.fgOriginStatusCode]: '200',
      [Headers.fgOriginStatusText]: 'OK',
      [Headers.fgOriginIgnoreCacheHeaders]: 'false',
      [Headers.fgScope]: Scope.PUBLIC,
      [Headers.strictTransportSecurity]:
        'max-age=31536000; includeSubdomains; preload',
      [Headers.vary]: 'Accept-Encoding, Accept, X-Requested-With, Origin',
      [Headers.xFrameOptions]: 'deny',
      [Headers.xRobotsTag]: 'noindex',
    }

    t.deepEqual(headers, {
      ...fastGraphHeaders,
      [Headers.fgCache]: CacheHitHeader.MISS,
      [Headers.xCache]: CacheHitHeader.MISS,
    })

    t.deepEqual(kvEntries, {
      'query-cache::e89713470c24a9be947d2f942e79661856821366049138599fdbfee8a1258aec':
        {
          body: originResponseJson,
          headers: {
            ...fastGraphHeaders,
            [Headers.fgCache]: CacheHitHeader.MISS,
            [Headers.xCache]: CacheHitHeader.MISS,
          },
        },
    })
    t.deepEqual(metadataEntries, {
      'query-cache::e89713470c24a9be947d2f942e79661856821366049138599fdbfee8a1258aec':
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
      ...fastGraphHeaders,
      [Headers.fgScope]: Scope.PUBLIC,
      [Headers.age]: '0',
      [Headers.fgCache]: CacheHitHeader.HIT,
      [Headers.xCache]: CacheHitHeader.HIT,
    })
  },
)

test.serial(
  'Should handle the request in scope AUTHENTICATED when "auth" directive was found',
  async (t) => {
    const { store: queryStore, metadata } = NewKVNamespace({
      name: 'QUERY_CACHE',
    })

    let req = WorktopRequest('POST', {
      schema: testSchema,
      query: droidWithArg,
    })
    let res = WorktopResponse()

    const originResponseJson = {
      data: {
        droid: {
          name: 'R2-D2',
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
    const kvEntries = getKVEntries(queryStore)
    const metadataEntries = Object.fromEntries(metadata)

    t.like(headers, {
      [Headers.fgScope]: Scope.AUTHENTICATED,
      [Headers.cacheControl]:
        'private, max-age=900, stale-if-error=60, stale-while-revalidate=900',
      [Headers.vary]:
        'Accept-Encoding, Accept, X-Requested-With, authorization, Origin',
      [Headers.fgCache]: CacheHitHeader.MISS,
      [Headers.xCache]: CacheHitHeader.MISS,
    })

    t.like(kvEntries, {
      'query-cache::e89713470c24a9be947d2f942e79661856821366049138599fdbfee8a1258aec':
        {
          body: originResponseJson,
          headers: {
            [Headers.fgScope]: Scope.AUTHENTICATED,
            [Headers.cacheControl]:
              'private, max-age=900, stale-if-error=60, stale-while-revalidate=900',
            [Headers.vary]:
              'Accept-Encoding, Accept, X-Requested-With, authorization, Origin',
            [Headers.fgCache]: CacheHitHeader.MISS,
            [Headers.xCache]: CacheHitHeader.MISS,
          },
        },
    })
    t.like(metadataEntries, {
      'query-cache::e89713470c24a9be947d2f942e79661856821366049138599fdbfee8a1258aec':
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

    t.like(headers, {
      [Headers.fgScope]: Scope.AUTHENTICATED,
      [Headers.vary]:
        'Accept-Encoding, Accept, X-Requested-With, authorization, Origin',
      'cache-control':
        'private, max-age=900, stale-if-error=60, stale-while-revalidate=900',
      [Headers.age]: '0',
      [Headers.fgCache]: CacheHitHeader.HIT,
      [Headers.xCache]: CacheHitHeader.HIT,
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
  const { store: queryStore, metadata } = NewKVNamespace({
    name: 'QUERY_CACHE',
  })

  let req = WorktopRequest('POST', {
    query: createReview,
  })
  let res = WorktopResponse()

  const originResponseJson = {
    data: {
      createReview: {
        id: 1,
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
  const kvEntries = getKVEntries(queryStore)
  const metadataEntries = Object.fromEntries(metadata)

  t.like(headers, {
    [Headers.fgCache]: CacheHitHeader.PASS,
    [Headers.xCache]: CacheHitHeader.MISS,
  })

  t.deepEqual(kvEntries, {})
  t.deepEqual(metadataEntries, {})

  await graphql(req, res)
  t.is(res.statusCode, 200)

  headers = Object.fromEntries(res.headers)

  t.like(headers, {
    [Headers.fgCache]: CacheHitHeader.PASS,
    [Headers.xCache]: CacheHitHeader.MISS,
  })
})

test.serial('Should respect max-age directive from origin', async (t) => {
  const { store: queryStore, metadata } = NewKVNamespace({
    name: 'QUERY_CACHE',
  })

  let req = WorktopRequest('POST', {
    query: simpleHero,
  })
  let res = WorktopResponse()

  const originResponseJson = {
    data: {
      hero: {
        name: 'R2-D2',
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
  const kvEntries = getKVEntries(queryStore)
  const metadataEntries = Object.fromEntries(metadata)

  t.is(
    headers['cache-control'],
    'public, max-age=65, stale-if-error=60, stale-while-revalidate=900',
  )

  t.like(kvEntries, {
    'query-cache::993f8cd4f05bd4830617ad3e781cec9d68ac28b92a8a35eb38485702e2ca9348':
      {
        body: originResponseJson,
        headers: {
          [Headers.cacheControl]:
            'public, max-age=65, stale-if-error=60, stale-while-revalidate=900',
          [Headers.fgCache]: CacheHitHeader.MISS,
          [Headers.xCache]: CacheHitHeader.MISS,
        },
      },
  })
  t.deepEqual(metadataEntries, {
    'query-cache::993f8cd4f05bd4830617ad3e781cec9d68ac28b92a8a35eb38485702e2ca9348':
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
    [Headers.cacheControl]:
      'public, max-age=65, stale-if-error=60, stale-while-revalidate=900',
    [Headers.age]: '0',
    [Headers.fgCache]: CacheHitHeader.HIT,
    [Headers.xCache]: CacheHitHeader.HIT,
  })
})

test.serial(
  'Should fail when origin does not respond with proper json content-type',
  async (t) => {
    NewKVNamespace({
      name: 'QUERY_CACHE',
    })

    let req = WorktopRequest('POST', {
      query: droidWithArg,
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
