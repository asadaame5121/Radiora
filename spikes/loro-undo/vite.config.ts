import { defineConfig } from "vite";

// Why this file exists (both settings were needed; measured with vite 7.3.7, 2026-10):
//
// `loro-crdt` exports `browser.development` -> `bundler/index.js`, which does a bare
// `import * as rawWasm from "./loro_wasm_bg.wasm"`. Vite dev refuses ESM wasm imports
// ("ESM integration proposal for Wasm is not supported currently") and the page fails with
// HTTP 500, while `vite build` resolves `browser.default` -> `browser/index.js` and works.
//
// 1. Dropping the `development` condition makes dev and build resolve the *same* entry, so the
//    dev server loads the wasm exactly like production does. Trade-off: the `development`
//    condition then disappears for every other dependency of the client graph. If that matters,
//    keep the default conditions and use `vite-plugin-wasm` instead (README §7.1).
// 2. The browser entry locates its wasm with `new URL("./loro_wasm_bg.wasm", import.meta.url)`.
//    When Vite pre-bundles the package into `node_modules/.vite/deps/`, that URL points next to
//    the generated bundle, where no wasm exists, and the synchronous XHR receives the SPA
//    fallback HTML: "WebAssembly.Module(): expected magic word 00 61 73 6d, found 3c 21 64 6f".
//    Serving the package unbundled keeps the URL next to the real asset.
export default defineConfig({
	resolve: {
		conditions: ["module", "browser", "import", "default"],
	},
	optimizeDeps: {
		exclude: ["loro-crdt"],
	},
});
