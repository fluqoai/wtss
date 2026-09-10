-- ============================================================
-- 0001_init.sql
-- Schema for the WhatsApp Auction Bids app (single-user: ecosofasa@gmail.com)
-- Run this in: Supabase → SQL Editor → New query → paste → Run
-- ============================================================

create extension if not exists pgcrypto;

-- جدول سجل نتائج المزايدات
create table if not exists public.bids (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  auction text not null,
  winner text not null,
  amount text not null,                                    -- "200 ريال" كما يرجعه الموديل
  amount_value numeric(12,2),                              -- الرقم فقط (nullable)
  currency text not null default 'SAR',
  model text,                                              -- الموديل المستخدم
  source_text text,                                        -- النص الأصلي (للتتبّع)
  created_at timestamptz not null default now()
);

create index if not exists bids_user_id_idx on public.bids(user_id);
create index if not exists bids_created_at_idx on public.bids(created_at desc);

-- ============================================================
-- RLS: المستخدم المسجّل فقط
-- ============================================================
alter table public.bids enable row level security;

drop policy if exists "bids_select_own_or_anon" on public.bids;
drop policy if exists "bids_insert_anyone" on public.bids;
drop policy if exists "bids_insert_own" on public.bids;
drop policy if exists "bids_update_owner" on public.bids;
drop policy if exists "bids_delete_owner" on public.bids;

-- قراءة: سجلات المستخدم فقط (لا anonymous)
create policy "bids_select_own"
  on public.bids
  for select
  using (user_id = auth.uid());

-- إدراج: فقط إذا كان user_id يساوي المستخدم الحالي
create policy "bids_insert_own"
  on public.bids
  for insert
  with check (user_id = auth.uid());

-- تعديل: سجلات المستخدم فقط
create policy "bids_update_own"
  on public.bids
  for update
  using (user_id = auth.uid());

-- حذف: سجلات المستخدم فقط
create policy "bids_delete_own"
  on public.bids
  for delete
  using (user_id = auth.uid());

-- ============================================================
-- (اختياري) سجل استخدامات AI
-- ============================================================
create table if not exists public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  model text not null,
  prompt_tokens int,
  completion_tokens int,
  cost_usd numeric(10,6),
  created_at timestamptz not null default now()
);

create index if not exists ai_usage_user_id_idx on public.ai_usage(user_id);
create index if not exists ai_usage_created_at_idx on public.ai_usage(created_at desc);

alter table public.ai_usage enable row level security;

drop policy if exists "ai_usage_select_owner" on public.ai_usage;
drop policy if exists "ai_usage_insert_anyone" on public.ai_usage;
drop policy if exists "ai_usage_insert_own" on public.ai_usage;

create policy "ai_usage_select_own"
  on public.ai_usage for select using (user_id = auth.uid());

create policy "ai_usage_insert_own"
  on public.ai_usage for insert with check (user_id = auth.uid());
