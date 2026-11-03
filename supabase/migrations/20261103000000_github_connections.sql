-- GitHub connections (B1.3): one row per Supabase user.
-- token_ciphertext is the GitHub OAuth token encrypted by the server with
-- AES-256-GCM (format v1:<iv>:<tag>:<ciphertext>, AAD bound to user_id).
-- The plaintext token and the encryption key never reach the database.

create table if not exists public.github_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  github_user_id bigint not null,
  github_login text not null,
  github_name text,
  github_avatar_url text,
  scopes text,
  token_ciphertext text not null,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.github_connections enable row level security;
-- No policies on purpose: browser roles (anon, authenticated) get no access.
-- Only the server's service_role key, which bypasses RLS, can read or write.
revoke all on public.github_connections from anon, authenticated;
