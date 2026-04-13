import { NextRequest, NextResponse } from "next/server"
import { syncMonth, getRecentMonths } from "@/lib/services/anacSync"

// Allow up to 5 minutes for full sync on Vercel Pro; free tier max is 60s
export const maxDuration = 300

export async function POST(request: NextRequest) {
  // Optional: allow caller to specify which months to sync
  let months: string[]
  try {
    const body = await request.json().catch(() => ({}))
    months = Array.isArray(body.months) && body.months.length > 0
      ? body.months
      : getRecentMonths(3)
  } catch {
    months = getRecentMonths(3)
  }

  const results = []
  let totalImported = 0
  let totalSkipped = 0
  let totalErrors = 0

  for (const month of months) {
    try {
      const result = await syncMonth(month)
      results.push(result)
      totalImported += result.imported
      totalSkipped += result.skipped
      totalErrors += result.errors
    } catch (err) {
      results.push({
        month,
        fetched: 0,
        imported: 0,
        skipped: 0,
        errors: 1,
        errorMessages: [err instanceof Error ? err.message : "Unknown error"],
      })
      totalErrors++
    }
  }

  return NextResponse.json({
    ok: true,
    totalImported,
    totalSkipped,
    totalErrors,
    results,
  })
}

// GET is used by Vercel Cron Jobs (no body)
export async function GET() {
  const months = getRecentMonths(1) // cron: only the current month
  try {
    const result = await syncMonth(months[0])
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    )
  }
}
