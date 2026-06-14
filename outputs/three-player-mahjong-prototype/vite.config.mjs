import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { attachAnmikaGameServer } from "./server/game-server.mjs";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: projectRoot,
  plugins: [
    {
      name: "anmika-socket-io-game-server",
      configureServer(server) {
        if (server.httpServer) attachAnmikaGameServer(server.httpServer);
      },
    },
  ],
  server: {
    host: "0.0.0.0",
    port: 5173,
    fs: {
      allow: [projectRoot],
    },
  },
});
