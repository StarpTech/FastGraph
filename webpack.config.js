const path = require('path')
const webpack = require('webpack')
const TerserPlugin = require('terser-webpack-plugin')
const { stripIgnoredCharacters } = require('graphql')
const LZUTF8 = require('lzutf8')
const { readFileSync } = require('fs')

const mode = process.env.NODE_ENV || 'production'

module.exports = {
  output: {
    filename: `worker.${mode}.js`,
    path: path.join(__dirname, 'dist'),
  },
  plugins: [
    new webpack.DefinePlugin({
      SCHEMA_STRING: JSON.stringify(
        LZUTF8.compress(
          stripIgnoredCharacters(readFileSync('./schema.graphql', 'utf-8')),
          { outputEncoding: 'StorageBinaryString' },
        ),
      ),
      'process.env': {
        NODE_ENV: JSON.stringify(mode),
      },
    }),
  ],
  mode,
  optimization: {
    minimize: true,
    minimizer: [
      new TerserPlugin({
        terserOptions: {
          ecma: undefined,
          parse: {},
          compress: {
            defaults: true,
            evaluate: false, // avoid big schema string in hot path
          },
          mangle: true,
        },
      }),
    ],
  },
  resolve: {
    extensions: ['.ts', '.js'],
    fallback: { buffer: false, crypto: false, url: false, util: false },
  },
  performance: {
    maxAssetSize: 1000000, // 1MB, cloudflare limit
    maxEntrypointSize: 1000000,
  },
  module: {
    rules: [
      {
        test: /\.ts?$/,
        loader: 'ts-loader',
      },
    ],
  },
}
