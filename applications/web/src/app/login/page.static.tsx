import type { Metadata } from "next";
import { BrowserStoreProvider } from "@/lib/garden/store/browser-provider";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { LoginScreen } from "./login-screen";

export const metadata: Metadata = { title: "Sign in" };

/**
 * `/login` in the static export. No server checks the session first: the form
 * itself sends a signed-in visitor on to the garden (browser store).
 */
export default function StaticLoginPage() {
  return (
    <BrowserStoreProvider>
      <LoginScreen configured={isSupabaseConfigured()} />
    </BrowserStoreProvider>
  );
}
