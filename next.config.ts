import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets the dev overlay load when browsing via 127.0.0.1 as well as localhost.
  allowedDevOrigins: ["127.0.0.1"],

  async headers() {
    return [
      {
        // The service worker must never be served stale: browsers only pick
        // up a new app version when this file byte-changes on the network.
        // (Vercel respects next.config headers for public/ files.)
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=0, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
