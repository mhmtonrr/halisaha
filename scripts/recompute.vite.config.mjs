// recompute-all.ts için: "server-only" korumasını betikte boş modüle çevirir, "@" takma adını tanır.
import { fileURLToPath } from "node:url";
const config = {
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./empty.mjs", import.meta.url)),
    },
  },
};
export default config;
