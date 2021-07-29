import * as DB from 'worktop/kv'
import type { KV } from 'worktop/kv'

// cloudflare global kv binding
declare const QUERY_CACHE: KV.Namespace

export interface Metadata {
  createdAt: number
  expirationTtl: number
}

export interface CachedQuery {
  headers: Record<string, string>
  body: string
}

export const key_item = (uid: string) => `query-cache::${uid}`

export function find(uid: string) {
  const key = key_item(uid)
  return DB.read<CachedQuery, Metadata>(QUERY_CACHE, key, {
    metadata: true,
    type: 'json',
  })
}

export function remove(pqKey: string) {
  const key = key_item(pqKey)
  return DB.remove(QUERY_CACHE, key)
}

export function save(uid: string, result: CachedQuery, expirationTtl: number) {
  const key = key_item(uid)

  expirationTtl = expirationTtl < 60 ? 60 : expirationTtl

  return DB.write(QUERY_CACHE, key, result, {
    expirationTtl,
    toJSON: true,
    metadata: {
      createdAt: Date.now(),
      expirationTtl,
    },
  })
}
