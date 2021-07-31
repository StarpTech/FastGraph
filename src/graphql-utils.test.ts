import test from 'ava'
import { buildSchema, parse } from 'graphql'
import { extractTypes } from './graphql-utils'

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
