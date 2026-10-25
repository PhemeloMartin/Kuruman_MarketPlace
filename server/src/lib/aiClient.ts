// Talks to the private Python category service (ai/service.py).
// If the service is down, slow or misconfigured we return null: the seller simply
// picks the category by hand. The marketplace never depends on the AI being up (spec 8.4).

export interface AiPrediction {
  modelVersion: string;
  suggestion: string | null;
  score: number | null;
  abstained: boolean;
  reason: string | null;
}

const TIMEOUT_MS = 2000; // spec 8.2: bounded timeout

export async function predictCategory(title: string, description: string, locale: string): Promise<AiPrediction | null> {
  const url = process.env.AI_SERVICE_URL;
  const token = process.env.AI_SERVICE_TOKEN;
  if (!url || !token) return null;
  try {
    const res = await fetch(`${url}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AI-Token": token },
      body: JSON.stringify({ title, description, locale }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    return (await res.json()) as AiPrediction;
  } catch (err: any) {
    // Record that the service failed - but never the listing text (spec 8.4).
    console.warn(`AI category service unavailable: ${err?.name ?? "error"} ${err?.message ?? ""}`.trim());
    return null;
  }
}

// ---------------------------------------------------------------------------
// Tier 2 models (same private service, same rule: if it's down, the site carries on without it)
// ---------------------------------------------------------------------------

async function callAi<T>(path: string, body: unknown, timeoutMs: number): Promise<T | null> {
  const url = process.env.AI_SERVICE_URL;
  const token = process.env.AI_SERVICE_TOKEN;
  if (!url || !token) return null;
  try {
    const res = await fetch(`${url}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-AI-Token": token },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    return (await res.json()) as T;
  } catch (err: any) {
    console.warn(`AI service ${path} unavailable: ${err?.name ?? "error"} ${err?.message ?? ""}`.trim());
    return null;
  }
}

export interface ReviewAnalysis {
  sentiment: "positive" | "neutral" | "negative";
  themes: string[];
}

export async function analyseReviews(texts: string[]) {
  return callAi<{ results: ReviewAnalysis[]; modelVersion: string }>("/reviews/analyse", { texts }, 5000);
}

export async function screenText(text: string) {
  return callAi<{ flag: boolean; score: number; reasons: string[]; modelVersion: string }>("/screen", { text }, 3000);
}

export async function forecastSales(history: { date: string; units: number }[]) {
  return callAi<{ enough: boolean; modelVersion: string; forecast?: { date: string; units: number }[] }>(
    "/forecast",
    { history },
    5000
  );
}
