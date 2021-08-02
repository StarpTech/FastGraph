import test from 'ava'
import { buildSchema, graphqlSync, parse } from 'graphql'
import {
  extractTypes,
  fetchAndStoreSchema,
  hasIntersectedTypes,
  introspectionQuery,
  requiresAuth,
} from './graphql-utils'
import { createKVNamespaces, getKVEntries, mockFetch } from './test-utils'
import { readFileSync } from 'fs'

const testSchema = readFileSync('./testdata/star_wars.graphql', 'utf8')
const droidWithArg = readFileSync(
  './testdata/queries/droid_with_arg.graphql',
  'utf8',
)
const simpleHero = readFileSync(
  './testdata/queries/simple_hero.graphql',
  'utf8',
)

test('extractTypes', async (t) => {
  let ids = extractTypes(buildSchema(testSchema), parse(droidWithArg))
  t.deepEqual([...ids], ['Droid'])
})

test('requiresAuth', async (t) => {
  let requires = requiresAuth(
    'auth',
    buildSchema(testSchema),
    parse(droidWithArg),
  )
  t.true(requires)
  requires = requiresAuth('auth', buildSchema(testSchema), parse(simpleHero))
  t.false(requires)
})

test('hasIntersectedTypes - matching', async (t) => {
  const document = parse(droidWithArg)
  let match = hasIntersectedTypes(buildSchema(testSchema), document, ['Droid'])
  t.true(match)
})

test('hasIntersectedTypes - not matching', async (t) => {
  const document = parse(simpleHero)
  let match = hasIntersectedTypes(buildSchema(testSchema), document, ['String'])
  t.false(match)
})

test('fetchAndStoreSchema', async (t) => {
  const KV = new Map()
  const KV_METADATA = new Map()
  createKVNamespaces(['GRAPHQL_SCHEMA'], KV, KV_METADATA)

  const data = graphqlSync({
    schema: buildSchema(testSchema),
    source: introspectionQuery,
  })
  const m = mockFetch(data, {
    'content-type': 'application/json',
  }).mock()
  t.teardown(() => m.revert())

  await fetchAndStoreSchema('http://foo.de', new Headers())

  const kvEntries = getKVEntries(KV, false)
  t.deepEqual(kvEntries, {
    'graphql-schema::latest':
      'directive@auth on OBJECT|FIELD_DEFINITION union SearchResult=Human|Droid|Starship type Query{hero:Character droid(id:ID!):Droid search(name:String!):SearchResult}type Mutation{createReview(episode:Episode!review:ReviewInput!):Review}type Subscription{remainingJedis:Int!}input ReviewInput{stars:Int!commentary:String}type Review{id:ID!stars:Int!commentary:String}enum Episode{NEWHOPE EMPIRE JEDI}interface Character{name:String!friends:[Character]}type Human implements Character{name:String!height:String!friends:[Character]}type Droid implements Character{name:String!primaryFunction:String!friends:[Character]}type Starship{name:String!length:Float!}',
  })
})
