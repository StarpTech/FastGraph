import * as DB from 'worktop/kv'
import type { KV } from 'worktop/kv'

// cloudflare global kv binding
declare const SCHEMA: KV.Namespace

export const key = `schema::latest`

export function find() {
  return DB.read<string>(SCHEMA, key, { type: 'text' })
}
