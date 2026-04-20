// Shim for react/compiler-runtime
// _c(n) creates a cache array of size n, pre-filled with a sentinel symbol
const SENTINEL = Symbol.for("react.memo_cache_sentinel");

export function c(size: number): any[] {
  const cache = new Array(size);
  for (let i = 0; i < size; i++) {
    cache[i] = SENTINEL;
  }
  return cache;
}
