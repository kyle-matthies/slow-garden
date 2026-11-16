import type { NextConfig } from "next";

const isDevelopment = process.env.NODE_ENV === "development";

/**
 * Build target (ADR-009 stage 3). Unset: the hosted app, exactly as before.
 * `GARDEN_STATIC_EXPORT=1`: a static export for a native shell or a static
 * host, with no Next server. See documents/operations/STATIC_EXPORT_2026-11-16.md.
 */
function staticExportRequested(): boolean {
  const value = process.env.GARDEN_STATIC_EXPORT ?? "";
  if (value === "" || value === "0") return false;
  if (value === "1") return true;
  // A typo must not quietly produce the other kind of build.
  throw new Error(
    `GARDEN_STATIC_EXPORT must be "1" or unset (got ${JSON.stringify(value)}).`,
  );
}
const isStaticExport = staticExportRequested();

function supabaseOrigins(): string[] {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!raw) {
    return [];
  }
  const url = new URL(raw);
  const secure = url.protocol === "https:";
  return [
    url.origin,
    `${secure ? "wss" : "ws"}://${url.host}`,
  ];
}

// Static policy applied to every route. Next.js emits inline bootstrap
// scripts and inline style attributes, so 'unsafe-inline' remains until a
// per-request nonce is issued from proxy.ts (see
// documents/operations/SECURITY_REVIEW_2026-09.md).
//
// `meta`: the same policy for a `<meta http-equiv>` tag, which is the only way
// a static export can carry one. Browsers ignore `frame-ancestors` there, so
// it is left out; framing must be refused by the host or the shell.
function contentSecurityPolicy({ meta = false } = {}): string {
  const connect = ["'self'", ...supabaseOrigins()];
  const script = ["'self'", "'unsafe-inline'"];
  if (isDevelopment) {
    script.push("'unsafe-eval'");
  }
  const directives = [
    "default-src 'self'",
    `script-src ${script.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${connect.join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ];
  if (!isDevelopment) {
    directives.push("upgrade-insecure-requests");
  }
  return directives
    .filter((directive) => !meta || !directive.startsWith("frame-ancestors"))
    .join("; ");
}

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy() },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  {
    key: "Permissions-Policy",
    value:
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=(), interest-cohort=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const shared: NextConfig = {
  // Development Server Function tracing includes arguments (private writing).
  logging: false,
  poweredByHeader: false,
  turbopack: {
    root: process.cwd(),
  },
};

/** The hosted app: unchanged. */
function serverConfig(): NextConfig {
  return {
    ...shared,
    async headers() {
      return [
        {
          source: "/(.*)",
          headers: securityHeaders,
        },
      ];
    },
  };
}

/**
 * The static export. Only files named `*.static.tsx` are routes, so the
 * server pages, the route handlers and `proxy.ts` are not part of this build
 * at all, and the static files are invisible to the hosted build. There is no
 * server to send headers; the policy travels in the document instead.
 */
function staticConfig(): NextConfig {
  const store = process.env.NEXT_PUBLIC_GARDEN_STORE ?? "";
  if (store !== "" && store !== "browser")
    throw new Error(
      "A static export has no server: NEXT_PUBLIC_GARDEN_STORE must be unset or \"browser\".",
    );
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  )
    throw new Error(
      "A static export cannot be configured after it is built: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.",
    );
  return {
    ...shared,
    output: "export",
    // `/garden` is written as `garden/index.html`, which any file server and
    // a native shell can serve without rewrite rules.
    trailingSlash: true,
    pageExtensions: ["static.tsx"],
    // Public build-time constants, inlined into the bundle.
    env: {
      NEXT_PUBLIC_GARDEN_STORE: "browser",
      NEXT_PUBLIC_GARDEN_TARGET: "static",
      NEXT_PUBLIC_GARDEN_CSP: contentSecurityPolicy({ meta: true }),
    },
  };
}

const nextConfig: NextConfig = isStaticExport ? staticConfig() : serverConfig();

export default nextConfig;
