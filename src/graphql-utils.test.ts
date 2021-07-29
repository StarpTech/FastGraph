import test from 'ava'
import { buildSchema, parse } from 'graphql'
import { extractIdsFromQuery, extractTypes } from './graphql-utils'

test('extractIdsFromQuery', async (t) => {
  let ids = extractIdsFromQuery(
    parse(`
    {
        stationWithEvaId(evaId: 8000105) {
          id
          name
          location {
            latitude (testId: 232323) {
                id
            }
            longitude
          }
          picture {
            url
          }
        }
      }
    `),
  )
  t.deepEqual([...ids], ['8000105', '232323'])

  ids = extractIdsFromQuery(
    parse(`
    mutation {
        updateThing(input: {id: "8000105", testId: "123", noIdentifier: 1}) {
            name
        }
    }
    `),
  )
  t.deepEqual([...ids], ['8000105', '123'])
})

test('extractTypes', async (t) => {
  let ids = extractTypes(
    buildSchema(`
        type Station {
            id: ID!
        }
        type Query {
            stationWithEvaId: Station
        }
    `),
    parse(`
      {
          stationWithEvaId {
            id
          }
        }
      `),
  )
  t.deepEqual([...ids], ['Station', 'ID!'])
})
