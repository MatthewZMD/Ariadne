import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: "Null Corridor — A Maze That Forgets",
  description: "A retro first-person maze that rewrites itself whenever you look away.",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: {
    title: "Null Corridor — A Maze That Forgets",
    description: "The maze changes where you cannot see.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Null Corridor retro maze" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Null Corridor — A Maze That Forgets",
    description: "The maze changes where you cannot see.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
