// Configuración de OpenNext para Cloudflare Workers.
// La app no usa ISR ni caché de datos de Next (todas las páginas son dinámicas y por usuario),
// así que no hace falta R2/KV para caché incremental.
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({});
