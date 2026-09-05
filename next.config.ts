import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Der Frame-Proxy spiegelt den Pfad der Zielseite 1:1. Wuerde Next den
  // Trailing Slash wegnormalisieren, loesten relative URLs im Frame falsch auf.
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
