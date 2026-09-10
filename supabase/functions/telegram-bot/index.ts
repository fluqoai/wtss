// supabase/functions/telegram-bot/index.ts
// Telegram bot that accepts forwarded WhatsApp messages, runs them through
// the same analyze pipeline, and writes to the bids table.
//
// Setup:
//   1. Talk to @BotFather on Telegram, /newbot, copy the token
//   2. Set env: TELEGRAM_BOT_TOKEN=...
//   3. Register webhook: POST this function URL with ?register=1
//   4. Forward any WhatsApp message to the bot from Telegram
//
// The bot assigns the bid to the configured AUTHORIZED_USER_ID (since the
// app is single-user). Set that env var to the ecosofasa@gmail.com UUID.

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN")
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
const AUTHORIZED_USER_ID = Deno.env.get("AUTHORIZED_USER_ID")
const DEFAULT_MODEL = Deno.env.get("DEFAULT_MODEL") ?? "nex-agi/nex-n2.5-mini:free"

if (!TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN missing")
if (!OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY missing")
if (!SUPABASE_URL) throw new Error("SUPABASE_URL missing")
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing")
if (!AUTHORIZED_USER_ID) throw new Error("AUTHORIZED_USER_ID missing")

const SYSTEM_PROMPT = `أنت أداة استخراج بيانات من رسائل واتساب لجروب مزايدات.
من النص المُعطى، استخرج فقط الرسائل التي تعلن بوضوح فوز شخص معين بمزاد (اسم الفايز + المبلغ).
تجاهل أي رسالة لا تحدد فايز واضح (مثل رسائل المزايدة العادية أو الأسئلة).
أرجع النتيجة فقط بصيغة JSON صحيحة، بدون أي نص إضافي أو علامات markdown، بهذا الشكل بالضبط:
[{"auction":"اسم أو رقم المزاد","winner":"اسم الفايز","amount":"المبلغ مع العملة إن وجدت"}]
إذا لم تجد أي فايز واضح في النص، أرجع مصفوفة فارغة: []`

const corsHeaders = { "Content-Type": "application/json" }

async function telegramApi(method: string, body: unknown) {
  const res = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  )
  return res.json()
}

async function callOpenRouter(text: string) {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: text },
      ],
    }),
  })
  return res.json()
}

async function saveBids(rows: { auction: string; winner: string; amount: string }[]) {
  const amountValue = (s: string) => {
    const m = s.match(/[\d.,]+/)
    if (!m) return null
    const n = Number(m[0].replace(/,/g, ""))
    return Number.isFinite(n) ? n : null
  }
  const payload = rows.map((r) => ({
    user_id: AUTHORIZED_USER_ID,
    auction: r.auction,
    winner: r.winner,
    amount: r.amount,
    amount_value: amountValue(r.amount),
    currency: "SAR",
    model: DEFAULT_MODEL,
    source_text: "(via telegram bot)",
  }))

  const res = await fetch(`${SUPABASE_URL}/rest/v1/bids`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Supabase insert failed: ${res.status} ${text}`)
  }
}

async function handleUpdate(update: {
  message?: { chat: { id: number }; text?: string; message_id: number }
}) {
  const msg = update.message
  if (!msg?.text) return

  const chatId = msg.chat.id
  const text = msg.text.trim()

  // Commands
  if (text === "/start" || text === "/help") {
    await telegramApi("sendMessage", {
      chat_id: chatId,
      text:
        "أرسل لي رسالة مزاد من واتساب (Forward) وأنا أستخرج الفايز والمبلغ وأحفظها في السجل.",
    })
    return
  }

  // Wait message
  await telegramApi("sendChatAction", { chat_id: chatId, action: "typing" })

  // Call OpenRouter
  let orData: { choices?: { message?: { content?: string } }[]; error?: { message?: string } }
  try {
    orData = await callOpenRouter(text)
  } catch (e) {
    await telegramApi("sendMessage", {
      chat_id: chatId,
      text: `خطأ في الاتصال بـ OpenRouter: ${(e as Error).message}`,
    })
    return
  }

  const raw = (orData.choices?.[0]?.message?.content ?? "").trim()
  if (!raw) {
    await telegramApi("sendMessage", {
      chat_id: chatId,
      text: "الموديل رجّع رد فارغ. تأكد أن الرسالة تحتوي مزاد واضح.",
    })
    return
  }

  const cleaned = raw
    .replace(/^```json/i, "")
    .replace(/^```/, "")
    .replace(/```$/, "")
    .trim()

  let parsed: { auction?: string; winner?: string; amount?: string }[]
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    await telegramApi("sendMessage", {
      chat_id: chatId,
      text: `الموديل رجّع رد غير مفهوم:\n${raw.slice(0, 300)}`,
    })
    return
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    await telegramApi("sendMessage", {
      chat_id: chatId,
      text: "ما لقيت أي فايز واضح في النص.",
    })
    return
  }

  // Save to Supabase
  try {
    await saveBids(
      parsed.map((p) => ({
        auction: p.auction || "—",
        winner: p.winner || "—",
        amount: p.amount || "—",
      }))
    )
  } catch (e) {
    await telegramApi("sendMessage", {
      chat_id: chatId,
      text: `خطأ في الحفظ: ${(e as Error).message}`,
    })
    return
  }

  // Reply with the extracted rows
  const lines = parsed
    .map(
      (r, i) =>
        `${i + 1}. ${r.auction || "—"} → ${r.winner || "—"} (${r.amount || "—"})`
    )
    .join("\n")
  await telegramApi("sendMessage", {
    chat_id: chatId,
    text: `تم حفظ ${parsed.length} نتيجة:\n${lines}`,
    reply_to_message_id: msg.message_id,
  })
}

async function registerWebhook(functionUrl: string) {
  const webhookUrl = functionUrl.replace(/\?.*$/, "")
  return telegramApi("setWebhook", { url: webhookUrl })
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url)

  // One-time webhook registration: GET /?register=1
  if (url.searchParams.has("register")) {
    const result = await registerWebhook(url.toString())
    return new Response(JSON.stringify(result), { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 })
  }

  try {
    const update = await req.json()
    await handleUpdate(update)
    return new Response("ok", { headers: corsHeaders })
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: corsHeaders }
    )
  }
})
