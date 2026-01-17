# ANAC OCDS Explorer Scaffold

This project provides a React frontend and a Node.js proxy backend for the ANAC OCDS API.

## Prerequisites
- Node.js 18+

## Configure
1) Copy `backend/.env.example` to `backend/.env`.
2) Adjust `ANAC_SEARCH_URL` and `ANAC_DETAIL_URL` using the API UI at:
   https://dati.anticorruzione.it/opendata/ocds/api/ui

## Run
Backend:
cd backend
npm install
npm run dev

Frontend:
cd ../frontend
npm install
npm run dev

Open http://localhost:5173
