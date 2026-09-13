// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.com>
// Project: ANAC-DB-codex — https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d
/**
 * /api/leads — Salva i lead (richieste report gare) su Supabase
 *               e invia notifica email all'admin via Resend
 *
 * Env vars richieste:
 *   RESEND_API_KEY — API key da https://resend.com/api-keys
 *   LEAD_NOTIFY_EMAIL — email destinatario notifiche (default: ing.giacomo.marani@gmail.com)
 */
import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { Resend } from "resend"

const ADMIN_EMAIL = process.env.LEAD_NOTIFY_EMAIL || "ing.giacomo.marani@gmail.com"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { nome, cognome, email, tender_id } = body ?? {}

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json({ error: "Email non valida" }, { status: 400 })
    }

    const leadData = {
      nome: String(nome || "").slice(0, 100),
      cognome: String(cognome || "").slice(0, 100),
      email: String(email).slice(0, 255).toLowerCase(),
      tender_id: tender_id ? String(tender_id).slice(0, 100) : null,
      source: "ricerca-gare",
    }

    // 1. Save to Supabase
    const supabase = createAdminClient()
    const { error: dbError } = await (supabase as unknown as { from: (t: string) => { insert: (v: Record<string, unknown>) => Promise<{ error: { message: string } | null }> } })
      .from("leads")
      .insert(leadData)

    if (dbError) {
      console.error("[leads] Supabase insert error:", dbError.message)
    }

    // 2. Send notification email to admin via Resend
    const resendKey = process.env.RESEND_API_KEY
    if (resendKey) {
      try {
        const resend = new Resend(resendKey)
        await resend.emails.send({
          from: "Tender AI DB <onboarding@resend.dev>",
          to: ADMIN_EMAIL,
          subject: `🔔 Nuovo lead: ${leadData.nome} ${leadData.cognome} — Tender AI DB`,
          html: `
            <div style="font-family: system-ui, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #1a1a1a; margin-bottom: 16px;">Nuovo lead da Analisi Avanzata</h2>
              <table style="width: 100%; border-collapse: collapse;">
                <tr style="border-bottom: 1px solid #eee;">
                  <td style="padding: 8px 0; font-weight: 600; color: #666; width: 120px;">Nome</td>
                  <td style="padding: 8px 0;">${leadData.nome || "—"}</td>
                </tr>
                <tr style="border-bottom: 1px solid #eee;">
                  <td style="padding: 8px 0; font-weight: 600; color: #666;">Cognome</td>
                  <td style="padding: 8px 0;">${leadData.cognome || "—"}</td>
                </tr>
                <tr style="border-bottom: 1px solid #eee;">
                  <td style="padding: 8px 0; font-weight: 600; color: #666;">Email</td>
                  <td style="padding: 8px 0;"><a href="mailto:${leadData.email}">${leadData.email}</a></td>
                </tr>
                <tr style="border-bottom: 1px solid #eee;">
                  <td style="padding: 8px 0; font-weight: 600; color: #666;">Gara ID</td>
                  <td style="padding: 8px 0;">${leadData.tender_id || "—"}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; font-weight: 600; color: #666;">Data</td>
                  <td style="padding: 8px 0;">${new Date().toLocaleString("it-IT", { timeZone: "Europe/Rome" })}</td>
                </tr>
              </table>
              <p style="margin-top: 24px; padding: 12px; background: #f5f5f5; border-radius: 8px; font-size: 13px; color: #666;">
                Questo lead è stato generato dalla pagina <strong>/ricerca-gare</strong> su
                <a href="https://tender-ai-db.vercel.app/ricerca-gare">tender-ai-db.vercel.app</a>
              </p>
            </div>
          `,
        })
      } catch (emailErr) {
        console.error("[leads] Resend email error:", emailErr)
        // Don't block UX for email failures
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error("[leads] Unexpected error:", err)
    return NextResponse.json({ success: true }) // Graceful degradation
  }
}
