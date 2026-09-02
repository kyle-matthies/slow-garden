"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

async function authenticatedTenant() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const tenantId = data?.claims?.sub;
  if (error || !tenantId) redirect("/login");
  return { supabase, tenantId };
}

export async function createGarden(formData: FormData) {
  const { supabase, tenantId } = await authenticatedTenant();
  const name = String(formData.get("name") ?? "").trim();
  if (!name || name.length > 120) {
    throw new Error("Garden names must be between 1 and 120 characters.");
  }

  const { error: accountError } = await supabase
    .from("accounts")
    .upsert({ id: tenantId }, { onConflict: "id" });
  if (accountError) throw accountError;

  const { error } = await supabase.from("gardens").insert({ tenant_id: tenantId, name });
  if (error) throw error;
  revalidatePath("/garden");
}

export async function createSeed(formData: FormData) {
  const { supabase } = await authenticatedTenant();
  const gardenId = String(formData.get("garden_id") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!gardenId || !body || body.length > 20_000) {
    throw new Error("A seed needs a garden and between 1 and 20,000 characters.");
  }

  const { error } = await supabase.rpc("create_seed", {
    p_garden_id: gardenId,
    p_body: body,
  });
  if (error) throw error;
  revalidatePath("/garden");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
