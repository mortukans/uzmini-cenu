// Web stub for native-only SDKs (ads). Everything is a no-op.
const noop = () => undefined;
const handler = { get: (_t, prop) => (prop === 'default' ? proxy : prop === '__esModule' ? true : proxy), apply: () => proxy };
const proxy = new Proxy(noop, handler);
module.exports = proxy;
