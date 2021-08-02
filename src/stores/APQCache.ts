import * as DB from 'worktop/kv'
import type { KV } from 'worktop/kv'

// cloudflare global kv binding
declare const APQ_CACHE: KV.Namespace

export interface APQResult {
  query: string
}

export const key_item = (uid: string) => `apq-cache::${uid}`

export function find(uid: string) {
  const key = key_item(uid)
  return DB.read<APQResult>(APQ_CACHE, key, {
    type: 'json',
  })
}

export function remove(pqKey: string) {
  const key = key_item(pqKey)
  return DB.remove(APQ_CACHE, key)
}

export function save(uid: string, result: APQResult) {
  const key = key_item(uid)

  return DB.write(APQ_CACHE, key, result, {
    toJSON: true,
  })
}
