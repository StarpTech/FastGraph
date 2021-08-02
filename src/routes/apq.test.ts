import test from 'ava'
import {
  getKVEntries,
  mockFetch,
  NewKVNamespace,
  WorktopRequest,
  WorktopResponse,
} from '../test-utils'
import { Headers } from '../utils'
import { apq } from './apq'

test.serial('Should return query result and store APQ', async (t) => {
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

  const headers = Object.fromEntries(res.headers)

  t.like(headers, {
    [Headers.cacheControl]:
      'public, max-age=900, stale-if-error=60, stale-while-revalidate=900',
    [Headers.contentType]: 'application/json',
    [Headers.gcdnOriginStatusCode]: '200',
    [Headers.gcdnOriginStatusText]: 'OK',
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

test.serial('Should respect max-age directive from origin', async (t) => {
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
      'public, max-age=65, stale-if-error=60, stale-while-revalidate=900',
    [Headers.contentType]: 'application/json',
    [Headers.gcdnOriginStatusCode]: '200',
    [Headers.gcdnOriginStatusText]: 'OK',
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
