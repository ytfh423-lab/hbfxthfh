// Shim for bun:bundle - feature() is a compile-time constant in Bun bundler.
// At runtime, we return false for all features (external build behavior).
export function feature(_name: string): boolean {
  return false;
}
