import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Image from "next/image";
import Link from "next/link";
import { REPO } from "./repo";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TalkContext – QA feedback your coding agent can read",
  description:
    "Click through a web app, say out loud what bugs you – and Claude Code gets structured feedback instead of a video. Open-source Chrome extension with live transcript, session replay and an MCP server.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
      <body className="font-sans">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <header className="flex items-center justify-between py-5">
            <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
              <Image src="/icon.svg" alt="" width={28} height={28} />
              TalkContext
            </Link>
            <a href={REPO} className="text-sm text-zinc-600 hover:text-zinc-900">
              GitHub →
            </a>
          </header>

          {children}

          <footer className="flex flex-wrap items-center justify-between gap-4 py-10 text-sm text-zinc-500">
            <span>TalkContext – open source QA recorder for coding agents</span>
            <nav className="flex gap-5">
              <a href={REPO} className="hover:text-zinc-900">
                GitHub
              </a>
              <Link href="/impressum" className="hover:text-zinc-900">
                Impressum
              </Link>
              <Link href="/datenschutz" className="hover:text-zinc-900">
                Datenschutz
              </Link>
            </nav>
          </footer>
        </div>
      </body>
    </html>
  );
}
