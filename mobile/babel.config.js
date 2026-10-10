module.exports = function (api) {
  api.cache(true)
  return {
    presets: ['babel-preset-expo'],
    // some dependencies (file-type, used for reading song tags) use the regex "v" flag, which Hermes lacks
    plugins: ['@babel/plugin-transform-unicode-sets-regex'],
  }
}
