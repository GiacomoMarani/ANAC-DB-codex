# ANAC OCDS Explorer Scaffold

This project provides a React frontend and Vercel serverless API proxy for the ANAC OCDS API,
focused on searching releases by CIG (tender ID).

Note: the public API does not expose free-text search, so the UI is CIG-based.
The proxy can resolve CIGs using the SmartCIG API, with an OCDS fallback that calls
`awards/tender/{id}` and then fetches releases by award ID.

## Prerequisites
- Node.js 18+
- Vercel CLI (optional for local API testing)

## Configure
1) Set `ANAC_SMARTCIG_URL`, `ANAC_AWARDS_TENDER_URL`, `ANAC_RELEASES_AWARD_URL`, and
   `ANAC_DETAIL_URL` in Vercel project envs (see `.env.example`).
2) For local dev, copy `.env.example` to `.env` for `vercel dev`.
3) Optional: copy `frontend/.env.example` to `frontend/.env` to point Vite at `http://localhost:3000`.

## Local dev
Terminal 1 (API):
vercel dev

Terminal 2 (frontend):
cd frontend
npm install
npm run dev

Open http://localhost:5173

## Deploy
- Import the repo into Vercel.
- Set the env vars in Vercel: `ANAC_SMARTCIG_URL`, `ANAC_AWARDS_TENDER_URL`,
  `ANAC_RELEASES_AWARD_URL`, `ANAC_DETAIL_URL`.
