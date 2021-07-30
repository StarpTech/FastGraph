<div align="center">
  <img src="logo.png" alt="graphcdn" />
</div>

<br/>

<div align="center">Cache GraphQL POST Requests on Cloudflare edges with zero configuration</div>

## Features

- Cache POST GraphQL queries
- Works with [Apollo Cache Control Plugin](https://www.apollographql.com/docs/apollo-server/performance/caching)
- Set appropriate cache headers `age`, `x-cache`, `cache-control`
- Cache authenticated data by types selection
- Cache can be invalidated programmatically with [cli-wrangler](https://developers.cloudflare.com/workers/cli-wrangler) or [REST API](https://api.cloudflare.com/#workers-kv-namespace-delete-key-value-pair)

## Caching semantics

All GraphQL queries are cached by default with a TTL of 900 seconds (15min). You can set a custom TTL per request by responding with a different `max-age` value from your origin.

### Cache authenticated data

When a GraphQL query contains one of the `PRIVATE_TYPES=User` the response is handled as user scoped. The _Authorization_ header is respected in the cache key to avoid exposing user-sensitive content. In order to use this feature, you also need to push your latest GraphQL schema to the _KV_ `GRAPHQL_SCHEMA` with the key `graphql-schema::latest`.

```sh
wrangler kv:key put --binding=GRAPHQL_SCHEMA graphql-schema::latest $YOUR_SCHEMA_STRING
```

When no schema was provided or no type was matched the request isn't cached as long as your origin respond with the appropriate `private`, `no-cache` or `no-store` cache-control directive.

## Getting Started

```sh
# Install project
npm install
# Install wrangler cli
npm i @cloudflare/wrangler -g
# Authenticate with your account
wrangler login
# Create key-value store
wrangler kv:namespace create "QUERY_CACHE"
# Deploy your worker
npm run deploy
```

## Example

```sh
curl --request POST \
  --url https://graphcdn.starptech.workers.dev/ \
  --header 'Accept-Encoding: gzip, deflate, br' \
  --header 'Content-Type: application/json' \
  --data '{"query":"{\n  stationWithEvaId(evaId: 8000105) {\n    name\n    location {\n      latitude\n      longitude\n    }\n    picture {\n      url\n    }\n  }\n}"}'
```

Cache GraphQL requests from [Deutsche Bahn](https://bahnql.herokuapp.com/graphql). Before `~900ms` after `~35ms`.

## Configuration

Set the variables in your `wrangler.toml`.

- `GRAPHQL_URL`. The GraphQL endpoint.
- `DEFAULT_TTL`. The default TTL (minimum 60s) of cacheable responses.
- `PRIVATE_TYPES`. The GraphQL types that indicates a private response (comma-separated).

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
