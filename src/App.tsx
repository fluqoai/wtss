import { useEffect, useState } from 'react'
import { Session } from '@supabase/supabase-js'
import { supabase, Bid } from './lib/supabase'
import { analyzeMessages, saveBids } from './lib/analyze'
import * as XLSX from 'xlsx'

const MODELS: { value: string; label: string }[] = [
  { value: 'meta-llama/llama-3.1-8b-instruct:free', label: 'مجاني — Llama 3.1 8B (للتجربة)' },
  { value: 'google/gemma-2-9b-it:free', label: 'مجاني — Gemma 2 9B (للتجربة)' },
  { value: 'anthropic/claude-3.5-haiku', label: 'Claude 3.5 Haiku (سريع ودقيق)' },
  { value: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet (الأدق)' },
  { value: 'custom', label: 'موديل آخر (أدخله يدوياً)' },
]

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [authStatus, setAuthStatus] = useState('')

  const [modelSelect, setModelSelect] = useState(MODELS[0].value)
  const [customModel, setCustomModel] = useState('')
  const [text, setText] = useState('')
  const [status, setStatus] = useState('')
  const [isError, setIsError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<Bid[]>([])

  // Restore session + load saved bids
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setAuthReady(true)
      if (data.session) loadBids()
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      if (s) loadBids()
      else setResults([])
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  async function loadBids() {
    const { data, error } = await supabase
      .from('bids')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500)
    if (error) {
      console.error(error)
      return
    }
    setResults((data ?? []) as Bid[])
  }

  async function handleAuth(e: React.FormEvent) {
    e.preventDefault()
    setAuthStatus('جاري المعالجة...')
    const fn = isSignUp
      ? supabase.auth.signUp({ email, password })
      : supabase.auth.signInWithPassword({ email, password })
    const { error } = await fn
    if (error) {
      setAuthStatus(error.message)
      return
    }
    if (isSignUp) {
      setAuthStatus('تم إنشاء الحساب — تحقق من بريدك أو سجّل دخول مباشرة')
    } else {
      setAuthStatus('')
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
  }

  async function handleAnalyze() {
    const model = modelSelect === 'custom' ? customModel.trim() : modelSelect
    if (!text.trim()) {
      setStatus('لصق نص الرسائل أولاً')
      setIsError(true)
      return
    }
    if (!model) {
      setStatus('حدد اسم الموديل')
      setIsError(true)
      return
    }

    setBusy(true)
    setStatus('جاري تحليل الرسائل...')
    setIsError(false)
    try {
      const parsed = await analyzeMessages(text, model)
      if (parsed.length === 0) {
        setStatus('ما لقيت أي فايز واضح بالنص يلي لصقته')
        setIsError(false)
        return
      }
      await saveBids(parsed, model, text)
      await loadBids()
      setText('')
      setStatus('تمت إضافة ' + parsed.length + ' نتيجة للجدول')
      setIsError(false)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'حدث خطأ'
      setStatus('خطأ: ' + msg)
      setIsError(true)
    } finally {
      setBusy(false)
    }
  }

  function handleDelete(id: string) {
    supabase.from('bids').delete().eq('id', id).then(() => loadBids())
  }

  function handleClear() {
    if (!confirm('متأكد تبي تفريغ كل السجلات؟')) return
    supabase
      .from('bids')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000')
      .then(() => loadBids())
  }

  function handleExport() {
    if (results.length === 0) return
    const sheetData = results.map((r, i) => ({
      '#': i + 1,
      'المزاد': r.auction,
      'الفايز': r.winner,
      'المبلغ': r.amount,
      'التاريخ': new Date(r.created_at).toLocaleString('ar-SA'),
    }))
    const ws = XLSX.utils.json_to_sheet(sheetData)
    ws['!cols'] = [{ wch: 5 }, { wch: 24 }, { wch: 20 }, { wch: 18 }, { wch: 22 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'نتائج المزايدات')
    XLSX.writeFile(wb, 'نتائج_المزايدات.xlsx')
  }

  // ====== AUTH SCREEN ======
  if (!authReady) {
    return <div className="wrap"><p className="status">جاري التحميل...</p></div>
  }
  if (!session) {
    return (
      <div className="auth-box">
        <h2>سجل نتائج المزايدات</h2>
        <p>{isSignUp ? 'إنشاء حساب جديد' : 'تسجيل الدخول'}</p>
        <form onSubmit={handleAuth}>
          <input
            type="email"
            placeholder="ecosofasa@gmail.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="كلمة المرور"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
          <button className="btn-primary" type="submit">
            {isSignUp ? 'إنشاء الحساب' : 'دخول'}
          </button>
        </form>
        <p style={{ marginTop: 12 }}>
          <button
            type="button"
            className="btn-link"
            onClick={() => {
              setIsSignUp(!isSignUp)
              setAuthStatus('')
            }}
          >
            {isSignUp ? 'لديك حساب؟ سجّل دخول' : 'ما عندك حساب؟ أنشئ واحد'}
          </button>
        </p>
        {authStatus && (
          <p className="status" style={{ marginTop: 8 }}>
            {authStatus}
          </p>
        )}
      </div>
    )
  }

  // ====== MAIN UI (نفس التصميم الأصلي) ======
  return (
    <div className="wrap">
      <div className="user-bar">
        <span>
          مسجّل دخول: <b>{session.user.email}</b>
        </span>
        <button className="btn-link" onClick={handleSignOut}>
          خروج
        </button>
      </div>

      <header>
        <div className="eyebrow-row">
          <span className="num">1</span>
          <h1>سجل نتائج المزايدات</h1>
        </div>
        <p className="sub">
          تلصق رسائل الجروب، وهو يستخرج الفايز والمبلغ ويحطهم بجدول جاهز للتصدير
        </p>
      </header>

      <section>
        <h2>
          <span className="num" style={{ width: 22, height: 22, fontSize: 13 }}>
            2
          </span>{' '}
          الموديل
        </h2>
        <label htmlFor="modelSelect">اختر الموديل</label>
        <select
          id="modelSelect"
          value={modelSelect}
          onChange={(e) => setModelSelect(e.target.value)}
        >
          {MODELS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
        {modelSelect === 'custom' && (
          <input
            type="text"
            placeholder="مثال: openai/gpt-4o-mini"
            value={customModel}
            onChange={(e) => setCustomModel(e.target.value)}
          />
        )}
      </section>

      <section>
        <h2>
          <span className="num" style={{ width: 22, height: 22, fontSize: 13 }}>
            3
          </span>{' '}
          لصق الرسائل
        </h2>
        <label htmlFor="messages">
          انسخ رسالة إغلاق المزاد (أو أكثر من رسالة) من الجروب ولصقها هنا
        </label>
        <textarea
          id="messages"
          placeholder={'مثال:\nالمزاد رقم 5 انتهى، الفايز أحمد بمبلغ 200 ريال\nمزاد الساعة اليدوية: سارة فازت بـ 150 ريال'}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          className="btn-primary"
          id="analyzeBtn"
          onClick={handleAnalyze}
          disabled={busy}
        >
          {busy ? 'جاري التحليل...' : 'تحليل الرسائل'}
        </button>
        <div className={'status' + (isError ? ' error' : '')}>{status}</div>
      </section>

      <section>
        <h2>
          <span className="num" style={{ width: 22, height: 22, fontSize: 13 }}>
            4
          </span>{' '}
          النتائج
        </h2>
        <div id="tableWrap">
          {results.length === 0 ? (
            <div className="empty">لسا ما في نتائج — حلل أول رسالة فوق</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>المزاد</th>
                  <th>الفايز</th>
                  <th>المبلغ</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={r.id}>
                    <td className="rownum">{results.length - i}</td>
                    <td>{r.auction}</td>
                    <td>{r.winner}</td>
                    <td className="amount">{r.amount}</td>
                    <td>
                      <button
                        className="del"
                        onClick={() => handleDelete(r.id)}
                        title="حذف"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {results.length > 0 && (
          <div className="table-actions">
            <button className="btn-gold" onClick={handleExport}>
              تصدير إكسل
            </button>
            <button className="btn-outline" onClick={handleClear}>
              تفريغ الجدول
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
