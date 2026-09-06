import vinext from "vinext";
import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";
// Use the same application in Node for local interaction reviews when the
// installed Workers emulator cannot support production's compatibility date.
const localPreview = process.env.ARIADNE_LOCAL_PREVIEW === "1";

export default defineConfig({
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      ...(!localPreview ? [cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
      })] : []),
    ],
});
