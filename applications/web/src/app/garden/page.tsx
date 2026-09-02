import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { createGarden, createSeed, signOut } from "./actions";

export const metadata: Metadata = { title: "Your garden" };
export const dynamic = "force-dynamic";

type Garden = { id: string; name: string };
type SeedRevision = { seed_id: string; body: string; created_at: string };

export default async function GardenPage() {
  if (!isSupabaseConfigured()) redirect("/login");

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const tenantId = claimsData?.claims?.sub;
  if (claimsError || !tenantId) redirect("/login");

  const [accountResult, gardensResult] = await Promise.all([
    supabase.from("accounts").upsert({ id: tenantId }, { onConflict: "id" }),
    supabase
      .from("gardens")
      .select("id,name")
      .eq("status", "active")
      .order("updated_at", { ascending: false }),
  ]);
  if (accountResult.error) throw accountResult.error;
  if (gardensResult.error) throw gardensResult.error;

  const gardens = (gardensResult.data ?? []) as Garden[];
  const activeGarden = gardens[0];
  let revisions: SeedRevision[] = [];

  if (activeGarden) {
    const { data } = await supabase
      .from("seed_revisions")
      .select("seed_id,body,created_at")
      .eq("garden_id", activeGarden.id)
      .order("created_at", { ascending: false })
      .limit(24);
    revisions = (data ?? []) as SeedRevision[];
  }

  const latestRevisions = Array.from(
    new Map(revisions.map((revision) => [revision.seed_id, revision])).values(),
  );

  return (
    <main className="garden-page">
      <header className="app-header">
        <Link className="wordmark" href="/">Slow Garden</Link>
        <div className="header-actions">
          <span className="identity-label">Private tenant</span>
          <form action={signOut}>
            <button className="plain-button" type="submit">Sign out</button>
          </form>
        </div>
      </header>

      {activeGarden ? (
        <div className="garden-layout">
          <aside className="garden-sidebar">
            <p className="panel-kicker">Your private gardens</p>
            <h1 className="garden-title">{activeGarden.name}</h1>
            <nav className="garden-list" aria-label="Your gardens">
              {gardens.map((garden) => (
                <span className="garden-pill" data-active={garden.id === activeGarden.id} key={garden.id}>
                  {garden.name}
                </span>
              ))}
            </nav>
            <form className="inline-form" action={createGarden}>
              <label className="panel-kicker" htmlFor="new-garden-name">Add another garden</label>
              <input id="new-garden-name" name="name" maxLength={120} placeholder="Garden name" required />
              <button className="secondary-button" type="submit">Create garden</button>
            </form>
          </aside>

          <section className="garden-main">
            <div className="capture-panel">
              <p className="panel-kicker">Capture without interruption</p>
              <h2>Plant a thought</h2>
              <form className="form-stack" action={createSeed}>
                <input type="hidden" name="garden_id" value={activeGarden.id} />
                <div className="field">
                  <label htmlFor="seed-body">What wants room to grow?</label>
                  <textarea id="seed-body" name="body" maxLength={20_000} placeholder="A fragment, question, observation, or unfinished thought…" required />
                </div>
                <button className="primary-button" type="submit">Plant quietly</button>
              </form>
            </div>

            <div className="seed-grid" aria-label="Recent seeds">
              {latestRevisions.map((revision) => (
                <article className="thought-card" key={revision.seed_id}>
                  <span className="panel-kicker">Seed</span>
                  <p>{revision.body}</p>
                  <time dateTime={revision.created_at}>
                    {new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(revision.created_at))}
                  </time>
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : (
        <section className="empty-state">
          <p className="panel-kicker">Private space ready</p>
          <h2>Name your first garden.</h2>
          <p>Gardens are isolated to your account. Creating one does not publish a profile, page, or link.</p>
          <form className="form-stack" action={createGarden}>
            <div className="field">
              <label htmlFor="first-garden-name">Garden name</label>
              <input id="first-garden-name" name="name" maxLength={120} placeholder="Unfinished thoughts" required />
            </div>
            <button className="primary-button" type="submit">Create my private garden</button>
          </form>
        </section>
      )}
    </main>
  );
}
