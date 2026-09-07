/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },

  /**
   * Reverse proxy verso dati.anticorruzione.it
   */
  async rewrites() {
    return [
      {
        source: "/anac-api/:path*",
        destination: "https://dati.anticorruzione.it/api/:path*",
      },
    ]
  },

  /**
   * Security headers + CORS per il proxy ANAC
   */
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      {
        source: "/anac-api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin",  value: "https://tender-ai-db.vercel.app" },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, X-CSRFToken, Accept" },
        ],
      },
    ]
  },
}

export default nextConfig
