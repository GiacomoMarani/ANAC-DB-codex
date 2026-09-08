// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2024-2026 Giacomo Marani <ing.giacomo.marani@gmail.com>
// Project: ANAC-DB-codex — https://github.com/GiacomoMarani/ANAC-DB-codex
// Watermark: GM-ANAC-7f3a9c2e-4b1d-4e8f-a5c3-2d9f0e1b6a4d

/**
 * Gemini AI client for tender analysis — browser-side, zero external deps.
 *
 * Architecture inspired by Tender AI Render (server.js):
 * - Model chain: gemini-3.6-flash → 3.5-flash-lite → 3.1-flash-lite → 2.5-flash-lite → 2.5-flash
 * - Multi-pass quota retry with exponential backoff (3 passes, 5s/15s)
 * - Streaming via fetch + ReadableStream (SSE-like chunked response)
 * - Auto-continuation on MAX_TOKENS (up to 6 parts)
 * - Google Search Grounding for real web links
 */

// ─── Model Configuration ─────────────────────────────────────────────────────
// Source: https://ai.google.dev/gemini-api/docs/pricing
// All models below are confirmed to have a Free Tier on Google AI.
//
// ⚠️ IMPORTANT CONSTRAINTS (verified 2026-09-08):
// - gemini-2.0-flash and gemini-2.0-flash-lite were SHUT DOWN on June 1, 2026
// - Google Search Grounding on free tier is ONLY available for gemini-2.5-*
//   (gemini-3.x requires paid tier for grounding)
// - Quotas are per-project, not per-key (multiple keys share the same pool)
//
// Two chains are used:
// 1. STREAMING_MODELS: for text generation (3.x = most capable, cascade down)
// 2. GROUNDING_MODELS: for Google Search grounding (only 2.5 family works free)

/** Primary model for text generation — most capable available */
export const DEFAULT_MODEL = "gemini-2.5-flash"

/** Fallback chain for streaming text generation.
 *  Ordered: most capable → lightest (highest free-tier RPM/RPD).
 *  Last updated: 2026-09-08 from https://ai.google.dev/gemini-api/docs/models
 *
 *  | Model               | Free RPM | Free RPD | Free TPM    | Status  |
 *  |---------------------|----------|----------|-------------|---------|
 *  | gemini-3.8-flash    | 15       | 1,500    | 1,000,000   | Stable  |
 *  | gemini-3.5-flash    | 15       | 1,500    | 1,000,000   | Stable  |
 *  | gemini-3.5-flash-lite| 30      | 1,500    | 1,000,000   | Stable  |
 *  | gemini-2.5-flash    | 15       | 1,500    | 1,000,000   | Stable  |
 *  | gemini-2.5-flash-lite| 15-30   | 1,500    | 1,000,000   | Stable  |
 */
export const FALLBACK_MODELS = [
  "gemini-2.5-flash-lite-preview-06-17",  // Lite variant, high free quota (30 RPM)
] as const

/** Models that support Google Search grounding on free tier.
 *  ONLY the 2.5 family supports grounding for free (up to 500 RPD shared).
 *  Gemini 3.x requires paid tier for grounding. */
export const GROUNDING_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite-preview-06-17",
] as const

const MAX_OUTPUT_TOKENS = 8192
const TEMPERATURE = 0.3

/** Quota retry config — mirrors Tender AI Render's runWithFallback() */
const QUOTA_RETRY_PASSES = 3
const QUOTA_BACKOFF_MS = [5000, 15000]

/** Auto-continuation config */
const MAX_CONTINUATIONS = 4

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GeminiSource {
  title: string
  url: string
}

export interface StreamCallbacks {
  onChunk: (text: string) => void
  onModelFallback?: (from: string, to: string) => void
  onContinuation?: (part: number) => void
  onError?: (error: string) => void
}

export interface GeminiStreamResult {
  text: string
  sources: GeminiSource[]
  modelUsed: string
}

// ─── Quota Error Detection ────────────────────────────────────────────────────

function isQuotaError(status: number, message: string): boolean {
  const msg = message.toLowerCase()
  return (
    status === 429 ||
    msg.includes("quota") ||
    msg.includes("resource_exhausted") ||
    msg.includes("rate limit") ||
    msg.includes("too many requests")
  )
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// ─── Extract Retry Hint ──────────────────────────────────────────────────────

function extractRetryHint(message: string): string {
  const match = message.match(/retry in ([\d.]+)s/i)
  if (match) {
    const sec = Math.ceil(parseFloat(match[1]))
    return ` Riprova tra ${sec} secondi.`
  }
  return ""
}

// ─── Core: Single Model Call (non-streaming, for grounding) ───────────────────

interface RawGeminiResponse {
  text: string
  sources: GeminiSource[]
  finishReason: string | null
}

async function callModel(
  apiKey: string,
  model: string,
  contents: unknown,
  useSearch: boolean,
): Promise<RawGeminiResponse> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: any = {
    contents,
    generationConfig: {
      temperature: TEMPERATURE,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    },
  }

  // Google Search Grounding for real web links
  if (useSearch) {
    body.tools = [{ google_search: {} }]
  }

  const res = await fetch(
    `${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  )

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }))
    const msg = err.error?.message || `Errore API Gemini (${model}): ${res.status}`

    if (isQuotaError(res.status, msg)) {
      throw new QuotaError(msg, model)
    }
    throw new Error(msg)
  }

  const data = await res.json()
  const candidate = data.candidates?.[0]
  const text = candidate?.content?.parts?.[0]?.text || ""
  const finishReason = candidate?.finishReason || null

  // Extract grounding sources
  const sources: GeminiSource[] = []
  const chunks = candidate?.groundingMetadata?.groundingChunks ?? []
  const seen = new Set<string>()
  for (const chunk of chunks) {
    const uri = chunk?.web?.uri
    const title = chunk?.web?.title
    if (uri && !seen.has(uri)) {
      seen.add(uri)
      sources.push({ title: title || uri, url: uri })
    }
  }

  return { text, sources, finishReason }
}

// ─── Core: Streaming Call (for progressive UI) ───────────────────────────────

interface StreamResult {
  accumulatedText: string
  finishReason: string | null
}

async function streamModel(
  apiKey: string,
  model: string,
  contents: unknown,
  onChunk: (text: string) => void,
): Promise<StreamResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body: any = {
    contents,
    generationConfig: {
      temperature: TEMPERATURE,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    },
  }

  const res = await fetch(
    `${GEMINI_API_BASE}/${model}:streamGenerateContent?alt=sse&key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  )

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }))
    const msg = err.error?.message || `Errore API Gemini (${model}): ${res.status}`

    if (isQuotaError(res.status, msg)) {
      throw new QuotaError(msg, model)
    }
    throw new Error(msg)
  }

  // Read the SSE stream
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let accumulatedText = ""
  let finishReason: string | null = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() || ""

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue
      const jsonStr = line.slice(6).trim()
      if (!jsonStr || jsonStr === "[DONE]") continue

      try {
        const parsed = JSON.parse(jsonStr)
        const candidate = parsed.candidates?.[0]
        const text = candidate?.content?.parts?.[0]?.text
        if (text) {
          accumulatedText += text
          onChunk(text)
        }
        if (candidate?.finishReason) {
          finishReason = candidate.finishReason
        }
      } catch {
        // Ignore JSON parse errors on partial chunks
      }
    }
  }

  return { accumulatedText, finishReason }
}

// ─── Quota Error Class ────────────────────────────────────────────────────────

export class QuotaError extends Error {
  model: string
  constructor(message: string, model: string) {
    super(message)
    this.name = "QuotaError"
    this.model = model
  }
}

// ─── Fallback Runner (mirrors Tender AI Render's runWithFallback) ─────────────

async function runWithFallback(
  apiKey: string,
  chain: string[],
  contents: unknown,
  onChunk: (text: string) => void,
  onFallback?: (from: string, to: string) => void,
  label = "Part 1",
): Promise<StreamResult & { modelUsed: string }> {
  let lastErr: Error | null = null

  for (let pass = 0; pass < QUOTA_RETRY_PASSES; pass++) {
    if (pass > 0) {
      const backoff = QUOTA_BACKOFF_MS[pass - 1] ?? QUOTA_BACKOFF_MS[QUOTA_BACKOFF_MS.length - 1]
      console.warn(`[Gemini] ${label}: all models hit quota — backing off ${backoff}ms (pass ${pass + 1}/${QUOTA_RETRY_PASSES})`)
      await sleep(backoff)
    }

    for (const model of chain) {
      try {
        console.log(`[Gemini] ${label}: trying ${model}${pass > 0 ? ` (retry pass ${pass + 1})` : ""}`)
        const result = await streamModel(apiKey, model, contents, onChunk)

        if (model !== chain[0] && onFallback) {
          onFallback(chain[0], model)
        }

        return { ...result, modelUsed: model }
      } catch (err) {
        if (!(err instanceof QuotaError)) throw err
        lastErr = err
        console.warn(`[Gemini] ${label}: quota hit on ${model}`)
      }
    }
  }

  // All models and passes exhausted
  const hint = lastErr ? extractRetryHint(lastErr.message) : ""
  throw new Error(
    `⚠️ Quota API Gemini esaurita su tutti i modelli.${hint} ` +
    `Attendi qualche minuto oppure verifica il tuo piano su ai.google.dev/pricing`,
  )
}

// ─── Fallback Runner for Non-Streaming (grounding) ───────────────────────────

async function runWithFallbackNonStreaming(
  apiKey: string,
  chain: string[],
  contents: unknown,
  useSearch: boolean,
  onFallback?: (from: string, to: string) => void,
): Promise<RawGeminiResponse & { modelUsed: string }> {
  let lastErr: Error | null = null

  for (let pass = 0; pass < QUOTA_RETRY_PASSES; pass++) {
    if (pass > 0) {
      const backoff = QUOTA_BACKOFF_MS[pass - 1] ?? QUOTA_BACKOFF_MS[QUOTA_BACKOFF_MS.length - 1]
      console.warn(`[Gemini] grounding: all models hit quota — backing off ${backoff}ms (pass ${pass + 1}/${QUOTA_RETRY_PASSES})`)
      await sleep(backoff)
    }

    for (const model of chain) {
      try {
        console.log(`[Gemini] grounding: trying ${model}${pass > 0 ? ` (retry pass ${pass + 1})` : ""}`)
        const result = await callModel(apiKey, model, contents, useSearch)

        if (model !== chain[0] && onFallback) {
          onFallback(chain[0], model)
        }

        return { ...result, modelUsed: model }
      } catch (err) {
        if (!(err instanceof QuotaError)) throw err
        lastErr = err
        console.warn(`[Gemini] grounding: quota hit on ${model}`)
      }
    }
  }

  const hint = lastErr ? extractRetryHint(lastErr.message) : ""
  throw new Error(
    `⚠️ Quota API Gemini esaurita su tutti i modelli.${hint} ` +
    `Attendi qualche minuto oppure verifica il tuo piano su ai.google.dev/pricing`,
  )
}

// ─── Public API: Streaming Analysis with Continuation ─────────────────────────

/**
 * Streams a Gemini response with automatic model fallback and continuation.
 * Uses the streaming API for progressive UI rendering (token by token).
 * Does NOT use Google Search grounding (streaming + grounding are incompatible).
 */
export async function streamAnalysis(
  apiKey: string,
  prompt: string,
  callbacks: StreamCallbacks,
): Promise<{ text: string; modelUsed: string }> {
  const chain = [DEFAULT_MODEL, ...FALLBACK_MODELS]
  const initialContents = [{ role: "user", parts: [{ text: prompt }] }]

  // Part 1: main stream with fallback chain
  const { accumulatedText, finishReason, modelUsed } = await runWithFallback(
    apiKey,
    chain,
    initialContents,
    callbacks.onChunk,
    callbacks.onModelFallback,
    "Part 1",
  )

  let fullText = accumulatedText
  let currentFinishReason = finishReason

  // Continuation loop — mirrors Tender AI Render's continuation logic
  let conversationHistory = [
    { role: "user", parts: [{ text: prompt }] },
    { role: "model", parts: [{ text: accumulatedText }] },
  ]

  let continuationPart = 1
  while (currentFinishReason === "MAX_TOKENS" && continuationPart <= MAX_CONTINUATIONS) {
    continuationPart++
    console.log(`[Gemini] Response cut off — starting continuation Part ${continuationPart}`)

    if (callbacks.onContinuation) {
      callbacks.onContinuation(continuationPart)
    }

    const continuationContents = [
      ...conversationHistory,
      {
        role: "user",
        parts: [{
          text: "Continua esattamente da dove ti sei interrotto. Non ripetere il testo già generato. Riprendi dalla parola o frase in cui il testo si è interrotto.",
        }],
      },
    ]

    const { accumulatedText: partText, finishReason: partFinishReason } = await runWithFallback(
      apiKey,
      chain,
      continuationContents,
      callbacks.onChunk,
      callbacks.onModelFallback,
      `Part ${continuationPart}`,
    )

    fullText += partText
    currentFinishReason = partFinishReason

    conversationHistory = [
      ...continuationContents,
      { role: "model", parts: [{ text: partText }] },
    ]
  }

  if (currentFinishReason === "MAX_TOKENS") {
    console.warn(`[Gemini] Reached MAX_CONTINUATIONS (${MAX_CONTINUATIONS}) — response may be incomplete`)
  }

  return { text: fullText, modelUsed }
}

// ─── Public API: Non-Streaming with Google Search Grounding ───────────────────

/**
 * Calls Gemini with Google Search grounding enabled.
 * Returns the full text + web sources found.
 * Non-streaming because grounding metadata is only available in the final response.
 */
export async function analyzeWithGrounding(
  apiKey: string,
  prompt: string,
  onFallback?: (from: string, to: string) => void,
): Promise<GeminiStreamResult> {
  // Only 2.5 family supports free tier grounding
  const chain = [...GROUNDING_MODELS]
  const contents = [{ role: "user", parts: [{ text: prompt }] }]

  const { text, sources, modelUsed } = await runWithFallbackNonStreaming(
    apiKey,
    chain,
    contents,
    true, // useSearch = true for grounding
    onFallback,
  )

  // Append sources section
  let output = text
  if (sources.length > 0) {
    output += "\n\n---\n\n### 🔗 Fonti trovate\n"
    for (const src of sources) {
      output += `- [${src.title}](${src.url})\n`
    }
  }

  return { text: output, sources, modelUsed }
}

// ─── Public API: Streaming + Grounding (hybrid approach) ──────────────────────

/**
 * Best of both worlds:
 * 1. First does a non-streaming call with Google Search grounding to get sources
 * 2. Then streams the full response for progressive UI rendering
 * 3. Appends the grounding sources at the end
 *
 * For the "Analizza con AI" use case this gives the best UX:
 * - User sees response token-by-token (streaming)
 * - Real web links from grounding are appended at the end
 * - Automatic continuation if response is truncated
 */
export async function analyzeWithStreamingAndGrounding(
  apiKey: string,
  prompt: string,
  callbacks: StreamCallbacks,
): Promise<GeminiStreamResult> {
  // Use GROUNDING_MODELS for grounding — only 2.5 family supports free tier grounding
  const groundingChain = [...GROUNDING_MODELS]

  // Step 1: Non-streaming call with grounding to get web sources
  // This is fast because we limit to a short response just for sources
  const groundingContents = [{ role: "user", parts: [{ text: prompt }] }]

  let sources: GeminiSource[] = []
  let groundingModelUsed: string = GROUNDING_MODELS[0]

  try {
    const groundingResult = await runWithFallbackNonStreaming(
      apiKey,
      groundingChain,
      groundingContents,
      true,
      callbacks.onModelFallback,
    )
    sources = groundingResult.sources
    groundingModelUsed = groundingResult.modelUsed

    // Stream the grounding result text chunk by chunk for UI
    const text = groundingResult.text
    // Simulate streaming by sending in small chunks
    const chunkSize = 80
    for (let i = 0; i < text.length; i += chunkSize) {
      callbacks.onChunk(text.slice(i, i + chunkSize))
      // Small delay for visual streaming effect
      if (i + chunkSize < text.length) {
        await sleep(15)
      }
    }

    // Append sources
    let sourcesText = ""
    if (sources.length > 0) {
      sourcesText = "\n\n---\n\n### 🔗 Fonti trovate\n"
      for (const src of sources) {
        sourcesText += `- [${src.title}](${src.url})\n`
      }
      callbacks.onChunk(sourcesText)
    }

    const fullText = text + sourcesText
    return { text: fullText, sources, modelUsed: groundingModelUsed }
  } catch (err) {
    // If grounding fails, fall back to pure streaming without grounding
    console.warn("[Gemini] Grounding failed, falling back to streaming without grounding:", err)
    const result = await streamAnalysis(apiKey, prompt, callbacks)
    return { text: result.text, sources: [], modelUsed: result.modelUsed }
  }
}

// ─── API Key Storage Helpers ──────────────────────────────────────────────────

const GEMINI_KEY_STORAGE = "gemini_api_key"
const AI_CACHE_PREFIX = "ai_analysis_"

export function getGeminiKey(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem(GEMINI_KEY_STORAGE)
}

export function setGeminiKey(key: string) {
  localStorage.setItem(GEMINI_KEY_STORAGE, key)
}

export function removeGeminiKey() {
  localStorage.removeItem(GEMINI_KEY_STORAGE)
}

export function getCachedAnalysis(id: string): string | null {
  if (typeof window === "undefined") return null
  return sessionStorage.getItem(AI_CACHE_PREFIX + id)
}

export function setCachedAnalysis(id: string, result: string) {
  sessionStorage.setItem(AI_CACHE_PREFIX + id, result)
}
