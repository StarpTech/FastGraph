export enum Headers {
  // FastGraph
  fgCache = 'fastgraph-cache',
  fgOriginStatusCode = 'fastgraph-origin-status-code',
  fgOriginStatusText = 'fastgraph-origin-status-text',
  fgOriginIgnoreCacheHeaders = 'fastgraph-origin-ignore-cache-headers',
  fgScope = 'fastgraph-scope',
  fgInspected = 'fastgraph-inspected',

  //cf
  cfCacheTag = 'cache-tag',

  // Common
  setCookie = 'set-cookie',
  contentType = 'content-type',
  cacheControl = 'cache-control',
  xCache = 'x-cache',
  authorization = 'authorization',
  vary = 'vary',
  xRobotsTag = 'x-robots-tag',
  xFrameOptions = 'x-frame-options',
  etag = 'etag',
  expires = 'expires',
  lastModified = 'last-modified',

  // CORS
  accessControlAllowCredentials = 'access-control-allow-credentials',
  accessControlAllowHeaders = 'access-control-allow-headers',
  accessControlAllowMethods = 'access-control-allow-methods',
  accessControlAllowOrigin = 'access-control-allow-origin',
  accessControlExposeHeaders = 'access-control-expose-headers',
  accessControlMaxAge = 'access-control-max-age',

  // Security
  contentSecurityPolicy = 'content-security-policy',
  strictTransportSecurity = 'strict-transport-security',
}

export enum Scope {
  AUTHENTICATED = 'AUTHENTICATED',
  PUBLIC = 'PUBLIC',
}

export enum CacheHitHeader {
  MISS = 'MISS',
  HIT = 'HIT',
  PASS = 'PASS',
  ERROR = 'ERROR',
}

export function isResponseCachable(res: Response): boolean {
  if (res.status === 206) return false

  const vary = res.headers.get('vary') || ''
  if (!!~vary.indexOf('*')) return false

  const ccontrol = res.headers.get(Headers.cacheControl) || ''
  if (/(private|no-cache|no-store)/i.test(ccontrol)) return false

  return true
}
