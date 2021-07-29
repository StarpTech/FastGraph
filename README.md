<div align="center">
  <img src="logo.png" alt="graphcdn" />
</div>

<br/>

<div align="center">Cache GraphQL POST Requests on Cloudflare edges with zero configuration</div>

## Features

* Cache GraphQL queries
* Works with [Apollo Cache Control Plugin](https://www.apollographql.com/docs/apollo-server/performance/caching)

## Caching semantics

Requests are cached by default with a TTL of 60 seconds. You can set a custom TTL per request. You only need to respond with a `Cache-Control: max-age: 600` header from your origin. Mutations aren't cached.

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

## Configuration

Set the `GRAPHQL_URL` variable in your `wrangler.toml`. It must point to your GraphQL endpoint.

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
