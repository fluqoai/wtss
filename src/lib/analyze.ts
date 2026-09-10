import { supabase } from './supabase'

export type AnalyzeResult = {
  auction: string
  winner: string
  amount: string
}

/**
 * Calls the Supabase Edge Function "analyze" which forwards the request
 * to OpenRouter with the secret API key. The frontend NEVER sees the key.
 */
export async function analyzeMessages(
  text: string,
  model: string
): Promise<AnalyzeResult[]> {
  const { data, error } = await supabase.functions.invoke<{
    choices?: { message?: { content?: string } }[]
    error?: { message?: string }
  }>('analyze', {
    body: { text, model },
  })

  if (error) {
    throw new Error(error.message || 'تعذر الاتصال بالمخدم')
  }

  if (data?.error) {
    throw new Error(data.error.message || 'خطأ من المخدم')
  }

  const raw =
    data?.choices?.[0]?.message?.content?.trim() ?? ''

  if (!raw) {
    throw new Error('الموديل رجّع رد فارغ')
  }

  // Strip markdown fences the model may add
  const cleaned = raw
    .replace(/^```json/i, '')
    .replace(/^```/, '')
    .replace(/```$/, '')
    .trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error('الموديل رجّع رد غير مفهوم، جرب موديل آخر')
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    return []
  }

  return parsed
    .filter(
      (item): item is { auction?: string; winner?: string; amount?: string } =>
        typeof item === 'object' && item !== null
    )
    .map((item) => ({
      auction: item.auction || '—',
      winner: item.winner || '—',
      amount: item.amount || '—',
    }))
}

/**
 * Persist a batch of new results into the `bids` table.
 * RLS requires user_id = auth.uid() AND user_id NOT NULL.
 */
export async function saveBids(
  rows: AnalyzeResult[],
  model: string,
  sourceText: string
) {
  const amountValue = (s: string) => {
    const m = s.match(/[\d.,]+/)
    if (!m) return null
    const n = Number(m[0].replace(/,/g, ''))
    return Number.isFinite(n) ? n : null
  }

  // RLS policy bids_insert_own requires user_id = auth.uid()
  const { data: userData, error: userErr } = await supabase.auth.getUser()
  if (userErr || !userData.user) {
    throw new Error('انتهت الجلسة — سجّل دخول مرة ثانية')
  }

  const payload = rows.map((r) => ({
    user_id: userData.user.id,
    auction: r.auction,
    winner: r.winner,
    amount: r.amount,
    amount_value: amountValue(r.amount),
    currency: 'SAR',
    model,
    source_text: sourceText.slice(0, 4000),
  }))

  const { error } = await supabase.from('bids').insert(payload)
  if (error) throw new Error(error.message)
}
