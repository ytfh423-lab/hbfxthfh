// Catch-all stub for missing internal/private packages
// Returns undefined for any property access via Proxy
const handler: ProxyHandler<any> = {
  get(_target, prop) {
    if (prop === '__esModule') return true;
    if (prop === Symbol.toPrimitive) return () => '';
    if (prop === 'default') return new Proxy({}, handler);
    // Return a no-op function that also acts as a proxy
    const fn = function (..._args: any[]) { return undefined; };
    return new Proxy(fn, handler);
  },
  apply() {
    return undefined;
  },
  construct() {
    return new Proxy({}, handler);
  },
};

const stub = new Proxy({}, handler);
export default stub;

// Named exports - use module.exports for maximum compatibility
// @ts-ignore
if (typeof module !== 'undefined') {
  module.exports = stub;
  module.exports.default = stub;
}
