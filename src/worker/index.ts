import { Hono } from "hono";
import type { AppEnv, Env } from "./env";
import { loadSession } from "./middleware";
import auth from "./routes/auth";

const app = new Hono<AppEnv>().basePath("/api");

app.use("*", loadSession);

app.route("/", auth);

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

  async scheduled(_event: ScheduledController, _env: Env, _ctx: ExecutionContext): Promise<void> {
    // Phase 4: hourly restock digest sweep.
  },
};
