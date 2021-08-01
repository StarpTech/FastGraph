import test from 'ava'
import { buildSchema, graphqlSync, parse } from 'graphql'
import {
  extractTypes,
  fetchAndStoreSchema,
  hasIntersectedTypes,
  introspectionQuery,
} from './graphql-utils'
import { createKVNamespaces, getKVEntries, mockFetch } from './test-utils'

test('extractTypes', async (t) => {
  let ids = extractTypes(
    buildSchema(/* GraphQL */ `
      type Station {
        id: ID!
      }
      type Query {
        stationWithEvaId: Station
      }
    `),
    parse(/* GraphQL */ `
      {
        stationWithEvaId {
          id
        }
      }
    `),
  )
  t.deepEqual([...ids], ['Station'])
})

test('hasIntersectedTypes - matching', async (t) => {
  const schema = /* GraphQL */ `
    type Station {
      id: ID!
    }
    type Query {
      stationWithEvaId: Station
    }
  `
  const document = parse(/* GraphQL */ `
    {
      stationWithEvaId {
        id
      }
    }
  `)
  let match = hasIntersectedTypes(schema, document, ['Station'])
  t.true(match)
})

test('hasIntersectedTypes - not matching', async (t) => {
  const schema = /* GraphQL */ `
    type Station {
      id: ID!
    }
    type Query {
      stationWithEvaId: Station
    }
  `
  const document = parse(/* GraphQL */ `
    {
      stationWithEvaId {
        id
      }
    }
  `)
  let match = hasIntersectedTypes(schema, document, ['ID'])
  t.false(match)
})

test.serial('fetchAndStoreSchema', async (t) => {
  const KV = new Map()
  const KV_METADATA = new Map()
  createKVNamespaces(['GRAPHQL_SCHEMA'], KV, KV_METADATA)

  const data = graphqlSync({
    schema: buildSchema(/* GraphQL */ `
      type Station {
        id: ID!
      }
      type Query {
        stationWithEvaId: Station
      }
    `),
    source: introspectionQuery,
  })
  const m = mockFetch(data, {
    'content-type': 'application/json',
  }).mock()
  t.teardown(() => m.revert())

  await fetchAndStoreSchema('http://foo.de', new Headers())

  const kvEntries = getKVEntries(KV, false)
  t.deepEqual(kvEntries, {
    'graphql-schema::latest': `type Station{id:ID!}type Query{stationWithEvaId:Station}`,
  })
})
