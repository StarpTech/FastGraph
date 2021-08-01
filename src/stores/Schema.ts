import * as DB from 'worktop/kv'
import type { KV } from 'worktop/kv'

// cloudflare global kv binding
declare const GRAPHQL_SCHEMA: KV.Namespace

export interface Metadata {
  updatedAt: number
}

const latestKey = `graphql-schema::latest`

export function latest() {
  return DB.read<string>(GRAPHQL_SCHEMA, latestKey, { type: 'text' })
}

export function save(schema: string) {
  return DB.write<string, Metadata>(GRAPHQL_SCHEMA, latestKey, schema, {
    metadata: {
      updatedAt: Date.now(),
    },
  })
}
