import { redirect } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { confirmedSession } from "@/lib/supabase/session";
import { LandingPage } from "./landing/landing-page";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (isSupabaseConfigured()) {
    const db = await createClient();
    // The same confirmed check the garden makes, so a session ended elsewhere
    // lands here and is not sent back and forth. No session cookie, no call.
    if (await confirmedSession(db)) redirect("/garden");
  }
  return (
    <LandingPage
      // Overnight tending stays off in production until its evaluation gate passes.
      tendingLive={process.env.GARDEN_AI_ENABLED === "true"}
      // Deletion is described only where it is switched on (after its migration is applied).
      deletionLive={process.env.GARDEN_DELETION_ENABLED === "true"}
    />
  );
}
