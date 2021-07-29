import * as DB from 'worktop/kv'
import type { KV } from 'worktop/kv'

// cloudflare global kv binding
declare const GRAPHQL_SCHEMA: KV.Namespace

export function latest() {
  return DB.read<string>(GRAPHQL_SCHEMA, `graphql-schema::latest`)
}
