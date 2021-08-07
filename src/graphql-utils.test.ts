import test from 'ava'
import { buildSchema, parse } from 'graphql'
import {
  extractTypes,
  hasIntersectedTypes,
  requiresAuth,
} from './graphql-utils'
import { readFileSync } from 'fs'

const testSchema = readFileSync('./testdata/star_wars.graphql', 'utf8')
const heroWithFragment = readFileSync(
  './testdata/queries/hero_with_fragment.graphql',
  'utf8',
)
const heroWithInlineFragment = readFileSync(
  './testdata/queries/hero_with_inline_fragment.graphql',
  'utf8',
)
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

test('requiresAuth - Should require authentication, using simple field', async (t) => {
  let requires = requiresAuth(
    'auth',
    buildSchema(testSchema),
    parse(droidWithArg),
  )
  t.true(requires)
})

test('requiresAuth - Should require authentication, using fragments', async (t) => {
  const requires = requiresAuth(
    'auth',
    buildSchema(testSchema),
    parse(heroWithFragment),
  )
  t.true(requires)
})

test.only('requiresAuth - Should require authentication, using inline fragments', async (t) => {
  const requires = requiresAuth(
    'auth',
    buildSchema(testSchema),
    parse(heroWithInlineFragment),
  )
  t.true(requires)
})

test('requiresAuth - Should not require authentication', async (t) => {
  const requires = requiresAuth(
    'auth',
    buildSchema(testSchema),
    parse(simpleHero),
  )
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
