-- Protect new saved-file writes while preserving older rows that exceed the new shape limits.
begin;

alter table public.saved_files alter column user_id set default auth.uid();
alter table public.saved_files add column if not exists content_sha256 text;

-- Backfill before adding checks so oversized legacy files survive; skip unchanged hashes on reruns.
update public.saved_files
set content_sha256 = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(content, 'UTF8')), 'hex')
where content_sha256 is distinct from pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(content, 'UTF8')), 'hex');
alter table public.saved_files alter column content_sha256 set not null;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.saved_files'::regclass and conname = 'saved_files_name_length_check') then
    alter table public.saved_files add constraint saved_files_name_length_check
      check (pg_catalog.char_length(name) between 1 and 255) not valid;
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.saved_files'::regclass and conname = 'saved_files_type_check') then
    alter table public.saved_files add constraint saved_files_type_check
      check (type in ('dockerfile', 'github-actions', 'env')) not valid;
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.saved_files'::regclass and conname = 'saved_files_repo_url_length_check') then
    alter table public.saved_files add constraint saved_files_repo_url_length_check
      check (repo_url is null or pg_catalog.char_length(repo_url) <= 2048) not valid;
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.saved_files'::regclass and conname = 'saved_files_content_size_check') then
    alter table public.saved_files add constraint saved_files_content_size_check
      check (pg_catalog.octet_length(content) <= 100000) not valid;
  end if;
end
$$;

create or replace function public.enforce_saved_files_limit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Recompute the digest on every insert so clients cannot supply a different de-duplication key.
  new.content_sha256 := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(new.content, 'UTF8')), 'hex');
  -- Serialize writes for this user so concurrent inserts cannot both consume the last free slot.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.user_id::text, 0));
  -- Filter by owner so the cap stays per user for every writer, with or without RLS.
  if (select pg_catalog.count(*) from public.saved_files where user_id = new.user_id) >= 500 then
    raise exception using errcode = 'check_violation', message = 'saved_files limit reached (500 per user)';
  end if;
  return new;
end
$$;

drop trigger if exists saved_files_limit_before_insert on public.saved_files;
create trigger saved_files_limit_before_insert
  before insert on public.saved_files
  for each row execute function public.enforce_saved_files_limit();
revoke execute on function public.enforce_saved_files_limit() from public, anon, authenticated;

-- Delete only exact duplicate saved copies created by repeated saves, keeping the earliest (created_at, id).
with duplicate_copies as (
  select id, pg_catalog.row_number() over (
    partition by user_id, name, repo_url, content_sha256
    order by created_at, id
  ) as copy_number
  from public.saved_files
)
delete from public.saved_files as saved
using duplicate_copies
where saved.id = duplicate_copies.id and duplicate_copies.copy_number > 1;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.saved_files'::regclass and conname = 'saved_files_unique_file') then
    alter table public.saved_files add constraint saved_files_unique_file
      unique nulls not distinct (user_id, name, repo_url, content_sha256);
  end if;
end
$$;

commit;
