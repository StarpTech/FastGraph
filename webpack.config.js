const path = require('path')

const mode = process.env.NODE_ENV || 'production'

module.exports = {
  output: {
    filename: `worker.${mode}.js`,
    path: path.join(__dirname, 'dist'),
  },
  mode,
  resolve: {
    extensions: ['.ts', '.js'],
    fallback: { buffer: false, crypto: false, url: false, util: false },
    plugins: [],
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
