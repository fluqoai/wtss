# سجل نتائج المزايدات (WhatsApp Auction Bids)

أداة بسيطة تستخرج الفائز والمبلغ من رسائل مزادات واتساب، عبر OpenRouter، وتحفظ النتائج في Supabase.

## البنية

- **Frontend**: Vite + React + TypeScript (static، يُرفع على Vercel)
- **Backend**: Supabase فقط
  - **Auth**: Supabase Auth (email + password)
  - **DB**: جدول `bids` (سجلات المزايدات) — RLS مُفعّل
  - **Edge Function**: `analyze` — يستدعي OpenRouter نيابة عن الواجهة (المفتاح في Supabase secrets)

## الإعداد المحلي

```bash
pnpm install        # أو npm install
cp .env.example .env.local
# عدّل القيمتين في .env.local من لوحة تحكم Supabase
pnpm dev            # http://localhost:5173
```

## الإعداد على Supabase

1. أنشئ مشروع جديد في [supabase.com](https://supabase.com).
2. **Authentication → Providers**: تأكد من تفعيل Email.
3. **SQL Editor → New query**: الصق محتوى `supabase/migrations/0001_init.sql` ثم Run.
4. أنشئ المستخدم الأول (ecosofasa@gmail.com) من داخل التطبيق عبر شاشة تسجيل الدخول (Sign Up).

## Edge Function (OpenRouter proxy)

```bash
# تثبيت Supabase CLI مرة واحدة
npm i -g supabase

# ربط المشروع (يدوياً، يطلب access token)
supabase login
supabase link --project-ref YOUR_PROJECT_REF

# رفع الدالة
supabase functions deploy analyze

# ضبط المفتاح (مخفي، لا يظهر للواجهة)
supabase secrets set OPENROUTER_API_KEY=sk-or-v1-xxxxxxxx
# اختياري: تقييد CORS على دومين Vercel
supabase secrets set ALLOWED_ORIGIN=https://your-app.vercel.app
```

## النشر على Vercel

1. ارفع هذا المجلد إلى GitHub.
2. في Vercel: New Project → استورد الـ repo.
3. **Environment Variables**:
   - `VITE_SUPABASE_URL` = من Supabase → Settings → API
   - `VITE_SUPABASE_ANON_KEY` = من نفس المكان
4. Deploy.

## ملاحظات

- مفتاح OpenRouter **لا يخرج من Supabase أبداً** — المتصفح يستدعي Edge Function، والـ function تستدعي OpenRouter.
- RLS تضمن أن المستخدم يرى/يحذف بياناته فقط.
- لا rate limiting — مفتوح كما طلبت.
