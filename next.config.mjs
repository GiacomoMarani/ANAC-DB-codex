/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },

  /**
   * Reverse proxy verso dati.anticorruzione.it
   *
   * Questo permette al browser di chiamare /anac-api/... come se fosse
   * same-origin — Next.js fa da proxy e invia i cookie ANAC automaticamente
   * (i Set-Cookie vengono impostati dal dominio di destinazione tramite
   * l'header Set-Cookie, ma NON funziona per HttpOnly in cross-origin).
   *
   * COSA FUNZIONA con questo approccio:
   * - Il browser chiama GET /anac-api/v1/security/csrf_token/
   * - Next.js fa da proxy verso dati.anticorruzione.it/api/v1/security/csrf_token/
   * - La risposta è JSON { result: "token" } leggibile dal browser
   * - Il browser usa il token + il cookie (che ha già da una visita precedente)
   *   per chiamare POST /anac-api/v1/chart/data
   *
   * LIMITAZIONE: i cookie HttpOnly di ANAC sono SameSite=Lax, quindi
   * non vengono inviati automaticamente sulle richieste cross-domain dal server.
   * Questo approccio funziona quando il browser ha già i cookie ANAC.
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
   * Headers per il proxy ANAC — abilita CORS sul proxy locale
   */
  async headers() {
    return [
      {
        source: "/anac-api/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin",  value: "*" },
          { key: "Access-Control-Allow-Methods", value: "GET, POST, OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "Content-Type, X-CSRFToken, Accept" },
        ],
      },
    ]
  },
}

export default nextConfig
