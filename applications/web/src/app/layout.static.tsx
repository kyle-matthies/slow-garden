import type { ReactNode } from "react";
import RootLayout from "./layout";

export { metadata, viewport } from "./layout";

/**
 * Root layout of the static export (GARDEN_STATIC_EXPORT=1): the hosted layout,
 * plus what the hosted app sends as response headers and a static bundle can
 * only say in the document. React moves both tags into `<head>`.
 *
 * Not expressible here, so left to the host or the native shell: framing
 * (`frame-ancestors`, `X-Frame-Options`), HSTS, `nosniff`, the permissions
 * policy and the cross-origin isolation headers.
 */
export default function StaticRootLayout({ children }: { children: ReactNode }) {
  return (
    <RootLayout>
      <meta httpEquiv="Content-Security-Policy" content={process.env.NEXT_PUBLIC_GARDEN_CSP} />
      <meta name="referrer" content="no-referrer" />
      {children}
    </RootLayout>
  );
}
