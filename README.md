<div align="center">
  <img src="logo.png" alt="graphcdn" />
</div>

<div align="center">
  <a href="https://github.com/StarpTech/GraphCDN/actions?query=workflow%3Aci">
    <img src="https://github.com/StarpTech/GraphCDN/actions/workflows/ci.yml/badge.svg?event=push" alt="CI" />
  </a>
</div>

## Features

- Cache POST GraphQL queries
- Works with [Apollo Cache Control Plugin](https://www.apollographql.com/docs/apollo-server/performance/caching)
- Set appropriate cache headers `age`, `x-cache`, `cache-control`
- Cache authenticated data when specific GraphQL types are used
- Cache can be invalidated programmatically with [cli-wrangler](https://developers.cloudflare.com/workers/cli-wrangler) or [REST API](https://api.cloudflare.com/#workers-kv-namespace-delete-key-value-pair)
- All benefits of [Cloudflare Workers](https://workers.cloudflare.com/) and [Cloudflare KV](https://www.cloudflare.com/products/workers-kv/)

## Caching semantics

All GraphQL queries are cached by default with a TTL of 900 seconds (15min). You can set a custom TTL per request by responding with a different `max-age` value from your origin.

### Cache authenticated data

You can change the cache scope to `AUTHENTICATED` to enforce all requests are cached in relation to the _Authorization_ header.
A more powerful feature is to mark specific GraphQL types as private. In this way a GraphQL query that contains e.g the following types `PRIVATE_TYPES=User,Profile` is handled as scope `AUTHENTICATED`. This can increase your cache hit rate dramatically. In order to use this feature, you have to provide your latest GraphQL schema to GraphCDN. We support two options:

1. Push the schema manually to cloudflare.

```sh
wrangler kv:key put --binding=GRAPHQL_SCHEMA graphql-schema::latest $YOUR_SCHEMA_STRING
```

2. Set the `INTROSPECTION_URL` variable and the schema is synchronized every minute. The endpoint must be publicly available.

By default when no schema was provided or no type was matched the request is always cached as long as your origin respond with the appropriate `private`, `no-cache` or `no-store` cache-control directive.

## Getting Started

```sh
# Install project
npm install
# Install wrangler cli
npm i @cloudflare/wrangler -g
# Authenticate with your account
wrangler login
# Deploy your worker
npm run deploy
```

## Example

### GraphCDN cURL request

```sh
curl --request POST \
  -v --compressed \
  -o /dev/null -sS \
  --url https://graphcdn.starptech.workers.dev \
  --header 'Accept-Encoding: gzip' \
  --header 'Content-Type: application/json' \
  --data '{"query":"{\n  projects {\n    edges {\n      node {\n        id\n      }\n    }\n  }\n}\n"}' \
  -w "Timings\n------\ntotal:   %{time_total}\nconnect: %{time_connect}\ntls:     %{time_appconnect}\n"
```

### Source API cURL request

```sh
curl --request POST \
  -v --compressed \
  -o /dev/null -sS \
  --url https://gitlab.com/api/graphql \
  --header 'Accept-Encoding: gzip' \
  --header 'Content-Type: application/json' \
  --data '{"query":"{\n  projects {\n    edges {\n      node {\n        id\n      }\n    }\n  }\n}\n"}' \
  -w "Timings\n------\ntotal:   %{time_total}\nconnect: %{time_connect}\ntls:     %{time_appconnect}\n"
```

## Latency Results

Here are some sample response times using this app hosted on Fly vs. making requests to the Open Library API directly:

| Request Method                               | Test 1 | Test 2 | Test 3 |
| -------------------------------------------- | ------ | ------ | ------ |
| [Gitlab API](https://gitlab.com/api/graphql) | 0.90s  | 1.01s  | 1.08s  |
| With GraphCDN                                | 0.15s  | 0.13s  | 0.11s  |

## Configuration

Set the variables in your `wrangler.toml`.

- `ORIGIN_URL`The url of your production backend you want your service to proxy to.
- `DEFAULT_TTL` The default TTL (minimum 60s) of cacheable responses (Default: 900)
- `PRIVATE_TYPES` The GraphQL types that indicates a private response (Default: "", Example: "User,Profile")
- `INJECT_ORIGIN_HEADERS` Should the origin headers be injected in the response? (Default: Options: "","1")
- `SCOPE` The default cache scope. Use `AUTHENTICATED` to enforce per-user cache based on `Authorization` header. (Default: "PUBLIC", Options: "PUBLIC","AUTHENTICATED")
- `IGNORE_ORIGIN_CACHE_HEADERS` Should the origin `cache-control` headers be respected? (Default: "", Options: "","1")
- `INTROSPECTION_URL` The url of your introspection endpoint. If you enable it a [cron-triggers](https://developers.cloudflare.com/workers/platform/cron-triggers) will fetch for the latest schema every 30 minutes. (Default: "")

## Performance & Security

All data is stored in the Key-value Store of cloudflare. Cloudflare KV is eventually-consistent and was designed for high-read low-latency use-cases. All data is encrypted at rest with 256-bit AES-GCM.

Check [How KV works](https://developers.cloudflare.com/workers/learning/how-kv-works) to learn more about it.

## Pricing

You can use the [free tier](https://developers.cloudflare.com/workers/platform/limits#worker-limits).

## Development & Deployment

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/StarpTech/GraphCDN)

```sh
npm run dev
```

### Detailed logs

```sh
wrangler tail
```
