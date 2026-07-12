/** API boot + public surface for the web runtime (S2 §1: one process, API + SSR). */
import { createApiServer } from "./server.js";

export { createApiServer } from "./server.js";
export { buildApiRoutes } from "./routes.js";
export type { ApiDeps, Handler } from "./routes.js";
export { cookies, json } from "./http.js";

if (process.env.NODE_ENV !== "test" && process.argv[1]?.endsWith("index.js")) {
  const port = Number(process.env.PORT ?? 3000);
  createApiServer().listen(port, () => {
    console.log(JSON.stringify({ msg: "api listening", port }));
  });
}
