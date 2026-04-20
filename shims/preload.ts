import { plugin } from "bun";
import { resolve } from "path";

// Force production mode to avoid React dev-mode useEffectEvent incompatibility
process.env.NODE_ENV = "production";

// Define MACRO as a global
(globalThis as any).MACRO = {
  VERSION: "2.1.114",
  GIT_HASH: "dev",
  BUILD_ID: "dev",
};

// Register module resolution plugin
plugin({
  name: "claude-code-shims",
  setup(build) {
    // Shim bun:bundle -> feature() always returns false
    build.module("bun:bundle", () => ({
      exports: {
        feature(_name: string): boolean {
          return false;
        },
      },
      loader: "object",
    }));

    // Shim react/compiler-runtime -> _c() cache function
    build.module("react/compiler-runtime", () => {
      const SENTINEL = Symbol.for("react.memo_cache_sentinel");
      return {
        exports: {
          c(size: number): any[] {
            const cache = new Array(size);
            for (let i = 0; i < size; i++) {
              cache[i] = SENTINEL;
            }
            return cache;
          },
        },
        loader: "object",
      };
    });

    // Redirect missing private/internal packages to a catch-all stub file
    const missingPackagePatterns = [
      /^@ant\//,
      /^@anthropic-ai\/mcpb/,
      /^@anthropic-ai\/sandbox-runtime/,
      /^@anthropic-ai\/claude-agent-sdk/,
      /^color-diff-napi/,
    ];

    build.onResolve({ filter: /^(@ant\/|@anthropic-ai\/(mcpb|sandbox-runtime|claude-agent-sdk)|color-diff-napi)/ }, (args) => {
      return {
        path: resolve(import.meta.dir, "catch-all-stub.ts"),
      };
    });

    // Resolve src/* imports to actual paths
    build.onResolve({ filter: /^src\// }, (args) => {
      const resolved = resolve(
        import.meta.dir,
        "..",
        args.path.replace(/^src\//, "src/")
      );
      return { path: resolved };
    });
  },
});
