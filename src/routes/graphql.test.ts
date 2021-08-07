import test from 'ava'
import { readFileSync } from 'fs'
import { key } from '../stores/Schema'
import {
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

const Cache = (caches as any).default

test.serial(
  'Should call origin and cache on subsequent requests',
  async (t) => {
    t.teardown(() => Cache.clear())
    // @ts-ignore
    globalThis.IGNORE_ORIGIN_CACHE_HEADERS = ''
    // @ts-ignore
    globalThis.AUTH_DIRECTIVE = ''

    let req = WorktopRequest('POST', {
      operationName: 'foo',
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

    const fastGraphHeaders = {
      [Headers.cacheControl]:
        'public, max-age=900, stale-if-error=900, stale-while-revalidate=900',
      [Headers.contentSecurityPolicy]: "default-src 'none'",
      [Headers.contentType]: 'application/json',
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

    const rawResp = await graphql(req, res)
    t.truthy(rawResp)

    if (rawResp) {
      t.is(rawResp.status, 200)

      headers = Object.fromEntries(rawResp.headers)

      t.deepEqual(await rawResp.json(), {
        data: {
          droid: {
            name: 'R2-D2',
          },
        },
      })

      t.deepEqual(headers, {
        ...fastGraphHeaders,
        [Headers.cfCacheTag]:
          'e89713470c24a9be947d2f942e79661856821366049138599fdbfee8a1258aec,foo',
        [Headers.fgScope]: Scope.PUBLIC,
        [Headers.fgCache]: CacheHitHeader.HIT,
        [Headers.xCache]: CacheHitHeader.HIT,
      })
    }
  },
)

test.serial(
  'Should handle the request in scope AUTHENTICATED when "auth" directive was found',
  async (t) => {
    t.teardown(() => Cache.clear())
    // @ts-ignore
    globalThis.IGNORE_ORIGIN_CACHE_HEADERS = ''
    // @ts-ignore
    globalThis.AUTH_DIRECTIVE = 'auth'

    const { store: schemaStore } = NewKVNamespace({
      name: 'SCHEMA',
    })
    schemaStore.set(key, testSchema)

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

    t.like(Object.fromEntries(res.headers), {
      [Headers.fgScope]: Scope.AUTHENTICATED,
      [Headers.cacheControl]:
        'private, max-age=900, stale-if-error=900, stale-while-revalidate=900',
      [Headers.vary]:
        'Accept-Encoding, Accept, X-Requested-With, authorization, Origin',
      [Headers.fgCache]: CacheHitHeader.MISS,
      [Headers.xCache]: CacheHitHeader.MISS,
    })

    const rawResp = await graphql(req, res)
    t.truthy(rawResp)

    if (rawResp) {
      t.is(rawResp.status, 200)

      t.deepEqual(await rawResp.json(), {
        data: {
          droid: {
            name: 'R2-D2',
          },
        },
      })

      t.like(Object.fromEntries(rawResp.headers), {
        [Headers.fgScope]: Scope.AUTHENTICATED,
        [Headers.vary]:
          'Accept-Encoding, Accept, X-Requested-With, authorization, Origin',
        'cache-control':
          'private, max-age=900, stale-if-error=900, stale-while-revalidate=900',
        [Headers.fgCache]: CacheHitHeader.HIT,
        [Headers.xCache]: CacheHitHeader.HIT,
      })
    }
  },
)

test.serial(
  'Should return 400 when "query" field is missing in body',
  async (t) => {
    t.teardown(() => Cache.clear())
    let req = WorktopRequest('POST', {})
    let res = WorktopResponse()

    await graphql(req, res)

    t.is(res.statusCode, 400)

    t.deepEqual(res.body, '{"error":"Request has no \\"query\\" field."}')
  },
)

test.serial('Should not cache mutations and proxy them through', async (t) => {
  t.teardown(() => Cache.clear())
  // @ts-ignore
  globalThis.IGNORE_ORIGIN_CACHE_HEADERS = ''

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

  t.like(headers, {
    [Headers.fgCache]: CacheHitHeader.PASS,
    [Headers.xCache]: CacheHitHeader.MISS,
    [Headers.cacheControl]: 'public, no-cache, no-store',
  })

  await graphql(req, res)
  t.is(res.statusCode, 200)

  headers = Object.fromEntries(res.headers)

  t.like(headers, {
    [Headers.fgCache]: CacheHitHeader.PASS,
    [Headers.xCache]: CacheHitHeader.MISS,
    [Headers.cacheControl]: 'public, no-cache, no-store',
  })
})

test.serial('Should pass cache-control header as it is', async (t) => {
  t.teardown(() => Cache.clear())
  // @ts-ignore
  globalThis.IGNORE_ORIGIN_CACHE_HEADERS = ''
  // @ts-ignore
  globalThis.AUTH_DIRECTIVE = ''

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
    [Headers.contentType]: 'application/json',
    [Headers.cacheControl]: 'public, max-age=60',
    [Headers.cfCacheTag]: 'tag',
    [Headers.etag]: 'etag',
    [Headers.expires]: 'expires',
    [Headers.lastModified]: 'lastModified',
  }).mock()
  t.teardown(() => m.revert())

  await graphql(req, res)

  t.is(res.statusCode, 200)
  t.deepEqual(res.body, originResponse)

  const rawResp = await graphql(req, res)
  t.truthy(rawResp)

  if (rawResp) {
    t.is(rawResp.status, 200)

    t.deepEqual(await rawResp.json(), {
      data: {
        droid: {
          name: 'R2-D2',
        },
      },
    })

    t.like(Object.fromEntries(rawResp.headers), {
      [Headers.contentType]: 'application/json',
      [Headers.cacheControl]: 'public, max-age=60',
      [Headers.cfCacheTag]: 'e89713470c24a9be947d2f942e79661856821366049138599fdbfee8a1258aec,tag',
      [Headers.etag]: 'etag',
      [Headers.expires]: 'expires',
      [Headers.lastModified]: 'lastModified',
      [Headers.fgScope]: Scope.PUBLIC,
      [Headers.fgCache]: CacheHitHeader.HIT,
      [Headers.xCache]: CacheHitHeader.HIT,
    })
  }
})

test.serial('Should ignore cache-control from origin', async (t) => {
  t.teardown(() => Cache.clear())
  // @ts-ignore
  globalThis.IGNORE_ORIGIN_CACHE_HEADERS = '1'
  // @ts-ignore
  globalThis.AUTH_DIRECTIVE = ''

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

  t.is(
    headers['cache-control'],
    'public, max-age=900, stale-if-error=900, stale-while-revalidate=900',
  )

  const rawResp = await graphql(req, res)
  t.truthy(rawResp)

  if (rawResp) {
    t.is(rawResp.status, 200)

    t.deepEqual(await rawResp.json(), {
      data: {
        hero: {
          name: 'R2-D2',
        },
      },
    })

    t.like(Object.fromEntries(rawResp.headers), {
      [Headers.cacheControl]:
        'public, max-age=900, stale-if-error=900, stale-while-revalidate=900',
      [Headers.fgCache]: CacheHitHeader.HIT,
      [Headers.xCache]: CacheHitHeader.HIT,
    })
  }
})

test.serial(
  'Should fail when origin does not respond with proper json content-type',
  async (t) => {
    t.teardown(() => Cache.clear())
    // @ts-ignore
    globalThis.IGNORE_ORIGIN_CACHE_HEADERS = ''

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

    const headers = Object.fromEntries(res.headers)

    t.like(headers, {
      [Headers.cacheControl]: 'public, no-cache, no-store',
    })
  },
)
