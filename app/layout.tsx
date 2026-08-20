import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001"),
  title: "Ariadne",
  description: "Follow Ariadne and find the exit!",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title: "Ariadne",
    description: "Follow Ariadne and find the exit!",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Ariadne retro maze" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Ariadne",
    description: "Follow Ariadne and find the exit!",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
