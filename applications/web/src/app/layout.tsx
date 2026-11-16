import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const editorial = Cormorant_Garamond({
  variable: "--font-editorial",
  subsets: ["latin"],
});

// Mobile first (D-024). `viewport-fit=cover` lets the garden run edge to edge
// behind the notch and home indicator; every bar pads itself with
// `env(safe-area-inset-*)`. `resizes-content` shrinks the layout when an
// on-screen keyboard opens (Chromium), so the save action stays above it;
// Safari is handled in the editor with `visualViewport`. Zoom is never disabled.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbf8ef" },
    { media: "(prefers-color-scheme: dark)", color: "#121a16" },
  ],
};

const promise = "Write by day. Wake to a bloom.";
const description =
  "A private journal with a method. You write, uninterrupted. Overnight, the garden is tended and returns at most three blooms that quote your own words. The thinking stays yours.";

export const metadata: Metadata = {
  title: {
    default: `Slow Garden · ${promise}`,
    template: "%s · Slow Garden",
  },
  description,
  applicationName: "Slow Garden",
  // Installability groundwork only: a manifest and icons. There is no service
  // worker, so nothing is cached or available offline (a separate decision).
  manifest: "/manifest.webmanifest",
  icons: {
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    title: "Slow Garden",
    statusBarStyle: "default",
  },
  formatDetection: { telephone: false },
  openGraph: {
    type: "website",
    siteName: "Slow Garden",
    title: `Slow Garden · ${promise}`,
    description,
  },
  twitter: {
    card: "summary",
    title: `Slow Garden · ${promise}`,
    description,
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${editorial.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
