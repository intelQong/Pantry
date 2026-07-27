import { Hono } from "hono";
import type { AppEnv, Env } from "./env";
import { nowSeconds } from "./env";
import { loadSession } from "./middleware";
import { runDigestSweep } from "./cron";
import auth from "./routes/auth";
import items from "./routes/items";
import list from "./routes/list";
import purchases from "./routes/purchases";
import push from "./routes/push";

const app = new Hono<AppEnv>().basePath("/api");

app.use("*", loadSession);

app.route("/", auth);
app.route("/", items);
app.route("/", list);
app.route("/", purchases);
app.route("/", push);

app.get("/health", (c) => c.json({ ok: true }));

app.notFound((c) => c.json({ error: "not_found", message: "No such endpoint." }, 404));

app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ error: "internal", message: "Something went wrong." }, 500);
});

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    // `run_worker_first: ["/api/*"]` means only API traffic reaches us; static
    // assets and the SPA fallback are handled by the assets binding. The guard
    // stays so tests and any future config change fail loudly, not silently.
    if (new URL(request.url).pathname.startsWith("/api/")) {
      return app.fetch(request, env, ctx);
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    await runDigestSweep(env, nowSeconds());
  },
};
