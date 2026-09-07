// The worker is invoked by a server scheduler, never by a browser.
// @ts-ignore shared executable module is also exercised by Node's test runner.
import { runOne, httpProvider } from "../_shared/garden-runtime.mjs";
Deno.serve(async (request: Request) => {
  const workerKey = Deno.env.get("GARDEN_WORKER_SECRET");
  if (
    !workerKey ||
    request.headers.get("Authorization") !== `Bearer ${workerKey}`
  )
    return new Response("Unauthorized", { status: 401 });
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!apiKey || !url || !key)
    return new Response("Worker not configured", { status: 503 });
  const rpc = async (name: string, args: unknown) => {
    const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error("ledger_request_failed");
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  };
  try {
    return Response.json(await runOne({ rpc, provider: httpProvider(apiKey) }));
  } catch {
    return new Response("Worker retry required", { status: 503 });
  }
});
