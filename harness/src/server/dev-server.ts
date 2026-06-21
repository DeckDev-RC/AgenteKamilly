import { startConfereLocalApi } from "./local-api.js";

const server = await startConfereLocalApi({ port: 3737 });

console.log(`Confere local API: ${server.url}`);
console.log("Press Ctrl+C to stop.");
