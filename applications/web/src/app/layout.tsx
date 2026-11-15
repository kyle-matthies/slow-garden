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

export const viewport: Viewport = {
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
