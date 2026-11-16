// The worker is invoked by a server scheduler or the operator, never by a browser.
// One invocation handles one job. The job carries its own transport, frozen when
// the pass was prepared: "batch" (file + batch, polled on later ticks) or "sync"
// (one Responses call per stage, settled in this invocation). The sync path
// bounds itself to stay inside the Edge Function time limit (see syncLimits in
// the shared runtime; the 150-second limit assumed there is not verified here).
//
// Callers: the operator with GARDEN_WORKER_SECRET, or the database scheduler
// with a single-use tick token (private.tick_garden_worker), redeemed once
// through consume_worker_tick. The long-lived secret is never in the database.
//
// Nothing is logged, and every response is a fixed string or the runtime's
// content-free report (fixed codes only), because pg_net keeps response bodies.
// @ts-ignore shared executable module is also exercised by Node's test runner.
import { authorizeWorker, runOne, httpProvider } from "../_shared/garden-runtime.mjs";
Deno.serve(async (request: Request) => {
  const workerKey = Deno.env.get("GARDEN_WORKER_SECRET");
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const rpc = async (name: string, args: unknown) => {
    const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key ?? "",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(10000),
    });
    // The ledger's error text is never passed on.
    if (!response.ok) throw new Error("ledger_request_failed");
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  };
  const allowed = await authorizeWorker({
    header: request.headers.get("Authorization"),
    workerKey,
    consume:
      url && key
        ? (token: string) => rpc("consume_worker_tick", { p_token: token })
        : undefined,
  });
  if (!allowed) return new Response("Unauthorized", { status: 401 });
  if (!apiKey || !url || !key)
    return new Response("Worker not configured", { status: 503 });
  try {
    return Response.json(await runOne({ rpc, provider: httpProvider(apiKey) }));
  } catch {
    return new Response("Worker retry required", { status: 503 });
  }
});
