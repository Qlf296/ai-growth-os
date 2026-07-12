/** API boot. */
import { createApiServer } from "./server.js";

export { createApiServer } from "./server.js";

if (process.env.NODE_ENV !== "test" && process.argv[1]?.endsWith("index.js")) {
  const port = Number(process.env.PORT ?? 3000);
  createApiServer().listen(port, () => {
    console.log(JSON.stringify({ msg: "api listening", port }));
  });
}
