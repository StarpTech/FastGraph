import test from 'ava'
import {
  getKVEntries,
  Mock,
  mockFetch,
  NewKVNamespace,
  WorktopRequest,
  WorktopResponse,
} from '../test-utils'
import { Headers } from '../utils'
import { apq } from './apq'

const Cache = (caches as any).default

test.serial('Should return query result and store APQ', async (t) => {
  // @ts-ignore
  globalThis.IGNORE_ORIGIN_CACHE_HEADERS = '1'

  Cache.match = Mock()
  Cache.put = Mock()

  const { store } = NewKVNamespace({
    name: 'APQ_CACHE',
  })

  let req = WorktopRequest(
    'GET',
    null,
    new URLSearchParams(
      'query={__typename}&extensions={"persistedQuery":{"version":1,"sha256Hash":"ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38"}}',
    ),
  )
  let res = WorktopResponse()

  const originResponse = JSON.stringify({
    data: {
      droid: {
        id: 123,
      },
    },
  })
  const m = mockFetch(originResponse, {
    'content-type': 'application/json',
  }).mock()
  t.teardown(() => m.revert())

  await apq(req, res)

  const putRequest = Cache.put.args()[0]

  t.is(
    putRequest.url,
    'http://fastgraph.de/?extensions=%7B%22persistedQuery%22%3A%7B%22version%22%3A1%2C%22sha256Hash%22%3A%22ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38%22%7D%7D&query=%7B__typename%7D',
  )

  const putResponse = Cache.put.args()[1]

  t.is(putResponse.body, '{"data":{"droid":{"id":123}}}')
  t.deepEqual(putResponse.headers, {
    'cache-control':
      'public, max-age=900, stale-if-error=900, stale-while-revalidate=900',
    'cache-tag':
      'ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38',
    'content-type': 'application/json',
    'fastgraph-origin-status-code': '200',
    'fastgraph-origin-status-text': 'OK',
    'fastgraph-scope': 'PUBLIC',
  })

  t.like(m.getArgs(), {
    input: 'https://grapql-endpoint/',
    init: {
      method: 'POST',
      body: '{"query":"{__typename}"}',
    },
  })

  const headers = Object.fromEntries(res.headers)

  t.like(headers, {
    [Headers.cacheControl]:
      'public, max-age=900, stale-if-error=900, stale-while-revalidate=900',
    [Headers.contentType]: 'application/json',
    [Headers.fgOriginStatusCode]: '200',
    [Headers.fgOriginStatusText]: 'OK',
  })

  t.is(res.statusCode, 200)
  t.deepEqual(res.body, '"{\\"data\\":{\\"droid\\":{\\"id\\":123}}}"')

  const kvEntries = getKVEntries(store)

  t.deepEqual(kvEntries, {
    'apq-cache::ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38':
      {
        query: '{__typename}',
      },
  })
})

test.serial(
  'Should pass query variables and operationName to origin',
  async (t) => {
    // @ts-ignore
    globalThis.IGNORE_ORIGIN_CACHE_HEADERS = '1'

    const { store } = NewKVNamespace({
      name: 'APQ_CACHE',
    })

    let req = WorktopRequest(
      'GET',
      null,
      new URLSearchParams(
        `variables=${JSON.stringify({
          echo: 'world',
        })}&operationName=foo&query={__typename}&extensions={"persistedQuery":{"version":1,"sha256Hash":"ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38"}}`,
      ),
    )
    let res = WorktopResponse()

    const originResponse = JSON.stringify({
      data: {
        droid: {
          id: 123,
        },
      },
    })
    const m = mockFetch(originResponse, {
      'content-type': 'application/json',
    }).mock()
    t.teardown(() => m.revert())

    await apq(req, res)

    t.like(m.getArgs(), {
      input: 'https://grapql-endpoint/',
      init: {
        method: 'POST',
        body: '{"query":"{__typename}","operationName":"foo","variables":{"echo":"world"}}',
      },
    })

    const headers = Object.fromEntries(res.headers)

    t.like(headers, {
      [Headers.cacheControl]:
        'public, max-age=900, stale-if-error=900, stale-while-revalidate=900',
      [Headers.contentType]: 'application/json',
      [Headers.fgOriginStatusCode]: '200',
      [Headers.fgOriginStatusText]: 'OK',
    })

    t.is(res.statusCode, 200)
    t.deepEqual(res.body, '"{\\"data\\":{\\"droid\\":{\\"id\\":123}}}"')

    const kvEntries = getKVEntries(store)

    t.deepEqual(kvEntries, {
      'apq-cache::ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38':
        {
          query: '{__typename}',
        },
    })
  },
)

test.serial('Should pass cache-control header as it is', async (t) => {
  // @ts-ignore
  globalThis.IGNORE_ORIGIN_CACHE_HEADERS = ''

  const { store } = NewKVNamespace({
    name: 'APQ_CACHE',
  })

  let req = WorktopRequest(
    'GET',
    null,
    new URLSearchParams(
      'query={__typename}&extensions={"persistedQuery":{"version":1,"sha256Hash":"ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38"}}',
    ),
  )
  let res = WorktopResponse()

  const originResponse = JSON.stringify({
    data: {
      droid: {
        id: 123,
      },
    },
  })
  const m = mockFetch(originResponse, {
    'content-type': 'application/json',
    'cache-control': 'public, max-age=65',
  }).mock()
  t.teardown(() => m.revert())

  await apq(req, res)

  const headers = Object.fromEntries(res.headers)

  t.like(headers, {
    [Headers.cacheControl]: 'public, max-age=65',
    [Headers.contentType]: 'application/json',
    [Headers.fgOriginStatusCode]: '200',
    [Headers.fgOriginStatusText]: 'OK',
  })

  t.is(res.statusCode, 200)
  t.deepEqual(res.body, '"{\\"data\\":{\\"droid\\":{\\"id\\":123}}}"')

  const kvEntries = getKVEntries(store)

  t.deepEqual(kvEntries, {
    'apq-cache::ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38':
      {
        query: '{__typename}',
      },
  })
})

test.serial('Should ignore cache-control from origin', async (t) => {
  // @ts-ignore
  globalThis.IGNORE_ORIGIN_CACHE_HEADERS = '1'

  const { store } = NewKVNamespace({
    name: 'APQ_CACHE',
  })

  let req = WorktopRequest(
    'GET',
    null,
    new URLSearchParams(
      'query={__typename}&extensions={"persistedQuery":{"version":1,"sha256Hash":"ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38"}}',
    ),
  )
  let res = WorktopResponse()

  const originResponse = JSON.stringify({
    data: {
      droid: {
        id: 123,
      },
    },
  })
  const m = mockFetch(originResponse, {
    'content-type': 'application/json',
    'cache-control': 'public, max-age=65',
  }).mock()
  t.teardown(() => m.revert())

  await apq(req, res)

  const headers = Object.fromEntries(res.headers)

  t.like(headers, {
    [Headers.cacheControl]:
      'public, max-age=900, stale-if-error=900, stale-while-revalidate=900',
    [Headers.contentType]: 'application/json',
    [Headers.fgOriginStatusCode]: '200',
    [Headers.fgOriginStatusText]: 'OK',
  })

  t.is(res.statusCode, 200)
  t.deepEqual(res.body, '"{\\"data\\":{\\"droid\\":{\\"id\\":123}}}"')

  const kvEntries = getKVEntries(store)

  t.deepEqual(kvEntries, {
    'apq-cache::ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38':
      {
        query: '{__typename}',
      },
  })
})

test.serial('Should resolve query and make request to origin', async (t) => {
  // @ts-ignore
  globalThis.IGNORE_ORIGIN_CACHE_HEADERS = '1'

  const { store } = NewKVNamespace({
    name: 'APQ_CACHE',
  })

  store.set(
    'apq-cache::ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38',
    {
      query: '{__typename}',
    },
  )

  let req = WorktopRequest(
    'GET',
    null,
    new URLSearchParams(
      'query={__typename}&extensions={"persistedQuery":{"version":1,"sha256Hash":"ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38"}}',
    ),
  )
  let res = WorktopResponse()

  const originResponse = JSON.stringify({
    data: {
      droid: {
        id: 123,
      },
    },
  })
  const m = mockFetch(originResponse, {
    'content-type': 'application/json',
  }).mock()
  t.teardown(() => m.revert())

  await apq(req, res)

  t.is(res.statusCode, 200)
  t.deepEqual(res.body, '"{\\"data\\":{\\"droid\\":{\\"id\\":123}}}"')
})

test.serial('Should error when hash does not match', async (t) => {
  NewKVNamespace({
    name: 'APQ_CACHE',
  })

  let req = WorktopRequest(
    'GET',
    null,
    new URLSearchParams(
      'query={__typename}&extensions={"persistedQuery":{"version":1,"sha256Hash":"ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38ooooooooo"}}',
    ),
  )
  let res = WorktopResponse()

  const originResponse = JSON.stringify({
    data: {
      droid: {
        id: 123,
      },
    },
  })
  const m = mockFetch(originResponse, {
    'content-type': 'application/json',
  }).mock()
  t.teardown(() => m.revert())

  await apq(req, res)

  t.is(res.statusCode, 400)
  t.deepEqual(res.body, '"provided sha does not match query"')
})

test.serial('Should return error becasue APQ could not be found', async (t) => {
  // @ts-ignore
  globalThis.IGNORE_ORIGIN_CACHE_HEADERS = '1'

  NewKVNamespace({
    name: 'APQ_CACHE',
  })

  let req = WorktopRequest(
    'GET',
    null,
    new URLSearchParams(
      'extensions={"persistedQuery":{"version":1,"sha256Hash":"ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38"}}',
    ),
  )
  let res = WorktopResponse()

  await apq(req, res)

  t.is(res.statusCode, 200)
  t.deepEqual(
    res.body,
    '{"data":{"errors":[{"extensions":{"code":"PERSISTED_QUERY_NOT_FOUND"}}]}}',
  )
})

test.serial('Should error when invalid APQ version is used', async (t) => {
  // @ts-ignore
  globalThis.IGNORE_ORIGIN_CACHE_HEADERS = '1'

  NewKVNamespace({
    name: 'APQ_CACHE',
  })

  let req = WorktopRequest(
    'GET',
    null,
    new URLSearchParams(
      'query={__typename}&extensions={"persistedQuery":{"version":2,"sha256Hash":"ecf4edb46db40b5132295c0291d62fb65d6759a9eedfa4d5d612dd5ec54a6b38ooooooooo"}}',
    ),
  )
  let res = WorktopResponse()

  const originResponse = JSON.stringify({
    data: {
      droid: {
        id: 123,
      },
    },
  })
  const m = mockFetch(originResponse, {
    'content-type': 'application/json',
  }).mock()
  t.teardown(() => m.revert())

  await apq(req, res)

  t.is(res.statusCode, 400)
  t.deepEqual(res.body, '"Unsupported persisted query version"')
})
