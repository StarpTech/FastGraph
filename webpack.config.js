const path = require('path')
const TerserPlugin = require('terser-webpack-plugin')

const mode = process.env.NODE_ENV || 'production'

module.exports = {
  devtool: "source-map",
  output: {
    filename: `worker.${mode}.js`,
    path: path.join(__dirname, 'dist'),
    devtoolModuleFilenameTemplate: "[absolute-resource-path]"
  },
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
