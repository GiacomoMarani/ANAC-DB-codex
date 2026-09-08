// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.com>
// Project: ANAC-DB-codex — https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d
/**
 * GET /api/anac-relay-script
 *
 * Serve lo script relay per profiling come JavaScript plain text.
 * Il bookmarklet lo carica con: fetch('/api/anac-relay-script').then(r=>r.text()).then(eval)
 */
import { NextResponse } from 'next/server';
import { ANAC_PROFILING_RELAY_READABLE } from '@/lib/anac-profiling-relay';

export async function GET() {
  return new NextResponse(ANAC_PROFILING_RELAY_READABLE, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
