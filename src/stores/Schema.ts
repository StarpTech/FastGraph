import * as DB from 'worktop/kv'
import type { KV } from 'worktop/kv'

// cloudflare global kv binding
declare const GRAPHQL_SCHEMA: KV.Namespace

const latestKey = `graphql-schema::latest`

export function latest() {
  return DB.read<string>(GRAPHQL_SCHEMA, latestKey, { type: 'text' })
}

export function save(schema: string) {
  return DB.write(GRAPHQL_SCHEMA, latestKey, schema)
}
