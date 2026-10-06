import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The frame proxy mirrors the target page's path 1:1. If Next normalized the
  // trailing slash away, relative URLs in the frame would resolve incorrectly.
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
