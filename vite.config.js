import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// The Tauri webview (WebKitGTK) keeps a disk cache between runs and can reuse stale
// dev modules after a restart, which breaks loading Svelte component CSS. Never let
// it cache anything from the dev server.
/** @type {import('vite').Plugin} */
const noStoreInDev = {
  name: "labelgood:no-store-in-dev",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use((_req, res, next) => {
      const setHeader = res.setHeader.bind(res);
      res.setHeader = /** @type {typeof res.setHeader} */ (
        (/** @type {string} */ name, /** @type {number | string | readonly string[]} */ value) =>
          setHeader(name, name.toLowerCase() === "cache-control" ? "no-store" : value)
      );
      res.setHeader("Cache-Control", "no-store");
      next();
    });
  },
};

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [noStoreInDev, sveltekit()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
