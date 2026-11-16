"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useGardenStore } from "@/lib/garden/store/context";

/**
 * Static export only: the landing page has no server to send a signed-in
 * visitor on to the garden, so this asks the store once and does it from the
 * browser. It renders nothing, and a failed check leaves the page as it is.
 */
export function SignedInRedirect() {
  const router = useRouter();
  const store = useGardenStore();
  useEffect(() => {
    let current = true;
    store.getSession().then(
      (session) => {
        if (current && session.signedIn) router.replace("/garden");
      },
      () => {},
    );
    return () => {
      current = false;
    };
  }, [store, router]);
  return null;
}
