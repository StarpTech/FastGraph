import * as DB from 'worktop/kv'
import type { KV } from 'worktop/kv'

// cloudflare global kv binding
declare const QUERY_CACHE: KV.Namespace

export interface CachedQuery {
  data: unknown
}

export const key_item = (uid: string) => `query-cache::${uid}`

export function find(uid: string) {
  const key = key_item(uid)
  return DB.read<string>(QUERY_CACHE, key, {
    metadata: true,
    type: 'text',
  })
}

export function remove(pqKey: string) {
  const key = key_item(pqKey)
  return DB.remove(QUERY_CACHE, key)
}

export function save(uid: string, result: string, expirationTtl: number) {
  const key = key_item(uid)

  return DB.write(QUERY_CACHE, key, result, {
    expirationTtl,
    metadata: {
      expiredAtInSec: Date.now() / 1000 + expirationTtl,
      expirationTtl,
    },
  })
}
