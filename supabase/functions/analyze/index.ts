// supabase/functions/analyze/index.ts
// OpenRouter proxy. The key is read from Supabase secrets — never sent to the browser.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")
if (!OPENROUTER_API_KEY) {
  throw new Error("OPENROUTER_API_KEY is not set in Supabase secrets")
}

const ALLOWED_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") ?? "*"

const SYSTEM_PROMPT = `أنت أداة استخراج بيانات من رسائل واتساب لجروب مزايدات.
من النص المُعطى، استخرج فقط الرسائل التي تعلن بوضوح فوز شخص معين بمزاد (اسم الفايز + المبلغ).
تجاهل أي رسالة لا تحدد فايز واضح (مثل رسائل المزايدة العادية أو الأسئلة).
أرجع النتيجة فقط بصيغة JSON صحيحة، بدون أي نص إضافي أو علامات markdown، بهذا الشكل بالضبط:
[{"auction":"اسم أو رقم المزاد","winner":"اسم الفايز","amount":"المبلغ مع العملة إن وجدت"}]
إذا لم تجد أي فايز واضح في النص، أرجع مصفوفة فارغة: []`

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

serve(async (req: Request) => {
  // Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }
  if (req.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: corsHeaders,
    })
  }

  try {
    const body = (await req.json()) as { text?: string; model?: string }
    const text = (body.text ?? "").toString().trim()
    const model = (body.model ?? "").toString().trim()

    if (!text) {
      return new Response(
        JSON.stringify({ error: { message: "text is required" } }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }
    if (!model) {
      return new Response(
        JSON.stringify({ error: { message: "model is required" } }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    const upstream = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "HTTP-Referer": "https://whats-bids.local",
          "X-Title": "WhatsApp Auction Bids",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: text },
          ],
        }),
      }
    )

    const data = await upstream.json().catch(() => ({}))

    if (!upstream.ok) {
      const message =
        (data && (data.error?.message || data.message)) ||
        `OpenRouter returned ${upstream.status}`
      return new Response(
        JSON.stringify({ error: { message: String(message) } }),
        {
          status: upstream.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      )
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return new Response(JSON.stringify({ error: { message } }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})
