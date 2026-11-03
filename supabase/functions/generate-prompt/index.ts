// Deploy as a Supabase Edge Function named "generate-prompt".
// Set OPENAI_API_KEY as a Supabase function secret before deploying.
// This function asks the model for one grammatically correct, funny fill-in-the-blank prompt.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const { style = "mixed", avoid = null } = await req.json().catch(() => ({}));
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return Response.json({ error: "OPENAI_API_KEY is not configured" }, { status: 503 });
  const styleText = style === "chaotic" ? "absurd, unpredictable, surreal humor" :
    style === "comedy" ? "clever comedy, punchlines, funny everyday situations" :
    "a varied mix of clever comedy and absurd chaotic humor";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      input: `Write exactly ONE original fill-in-the-blank party-game prompt. Style: ${styleText}.
Rules: grammatically correct, one clear blank written as _____, concise, funny, easy to understand, and designed to invite many different answers. Adult/edgy humor is okay, but do not target protected groups or encourage real-world harm. Do not include an answer. Return only the prompt text. Avoid being too similar to this recent prompt: ${avoid || "none"}.`
    })
  });
  if (!response.ok) return Response.json({ error: "Prompt generation failed" }, { status: 502 });
  const data = await response.json();
  const prompt = (data.output || []).flatMap((o: any) => o.content || []).find((c: any) => c.type === "output_text")?.text?.trim();
  if (!prompt || !prompt.includes("_____")) return Response.json({ error: "The generated prompt was invalid" }, { status: 502 });
  return Response.json({ prompt });
});