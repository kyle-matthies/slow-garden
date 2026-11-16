import { BrowserStoreProvider } from "@/lib/garden/store/browser-provider";
import { LandingPage } from "./landing/landing-page";
import { SignedInRedirect } from "./landing/signed-in-redirect";

/**
 * `/` in the static export (GARDEN_STATIC_EXPORT=1). The hosted page reads the
 * session and the two deployment switches per request; here the switches are
 * read once, when the bundle is built, and a signed-in visitor is sent on to
 * the garden from the browser.
 */
export default function StaticHome() {
  return (
    <>
      <BrowserStoreProvider>
        <SignedInRedirect />
      </BrowserStoreProvider>
      <LandingPage
        tendingLive={process.env.GARDEN_AI_ENABLED === "true"}
        deletionLive={process.env.GARDEN_DELETION_ENABLED === "true"}
      />
    </>
  );
}
