import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./field.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://ariadne-game.matthewzmd.workers.dev"),
  title: "Ariadne",
  description: "A field of white fog, a thread of light beside you, and the next way. She is sure.",
  icons: { icon: "/favicon.svg?v=field", shortcut: "/favicon.svg?v=field" },
  openGraph: {
    title: "Ariadne",
    description: "A field of white fog, a thread of light beside you, and the next way. She is sure.",
    images: [{ url: "/fog/images/og.png", width: 1200, height: 630, alt: "Ariadne, in fog" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Ariadne",
    description: "A field of white fog, a thread of light beside you, and the next way. She is sure.",
    images: ["/fog/images/og.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
