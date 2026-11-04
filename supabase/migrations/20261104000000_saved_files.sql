-- Saved files: generated files a user chose to keep ("Save to Account").
-- The browser reads and writes this table directly, with the anon key and the user's
-- session (SavedFilesAPI in client/src/lib/api.ts): insert with a returning select,
-- select ordered by created_at, and delete by id with a returning select. It never
-- updates a row. The server does not use this table.
--
-- Idempotent and non-destructive: safe to run again, and safe over a table created
-- earlier from the SQL that DEPLOYMENT-GUIDE.md used to contain. It never drops the
-- table, never changes columns and never touches rows.

create table if not exists public.saved_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null,
  repo_url text,
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists saved_files_user_created_idx on public.saved_files (user_id, created_at desc);

alter table public.saved_files enable row level security;

-- Each signed-in user sees, adds and removes only their own rows. There is no update
-- policy, so rows cannot be edited.
drop policy if exists "Users read own files" on public.saved_files;
create policy "Users read own files" on public.saved_files
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "Users insert own files" on public.saved_files;
create policy "Users insert own files" on public.saved_files
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "Users delete own files" on public.saved_files;
create policy "Users delete own files" on public.saved_files
  for delete to authenticated using (auth.uid() = user_id);

-- Exactly the privileges the browser uses. Supabase's default privileges grant every
-- table privilege to anon and authenticated; anon never uses this table (the app reads
-- it only when signed in), and nobody updates, truncates or references it.
revoke all on public.saved_files from anon, authenticated;
grant select, insert, delete on public.saved_files to authenticated;
