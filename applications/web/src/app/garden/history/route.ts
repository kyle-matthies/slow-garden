import { createClient } from "@/lib/supabase/server";
import { allRows } from "@/lib/garden/data";
export async function GET(request: Request) {
  const db = await createClient();
  const { data, error } = await db.auth.getClaims();
  if (error || !data?.claims?.sub)
    return new Response("Unauthorized", { status: 401 });
  const id = new URL(request.url).searchParams.get("entry");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id))
    return new Response("Invalid entry", { status: 400 });
  try {
    const rows = await allRows((a, b) =>
      db
        .from("seed_revisions")
        .select("id,body,created_at,revision_number")
        .eq("entry_id", id)
        .order("revision_number", { ascending: false })
        .range(a, b),
    );
    return Response.json(rows, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return new Response("History unavailable", { status: 503 });
  }
}
