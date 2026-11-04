// supabase/migrations/*_saved_files.sql against a throwaway local Postgres
// (TEST_DATABASE_URL), with stubs of the Supabase objects it references: the auth
// schema, auth.users, auth.uid() (reads request.jwt.claim.sub) and the anon and
// authenticated roles, plus Supabase's default grants on new public tables.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { SERVER_DIR } from './helpers.js';
import { DB_SKIP, TEST_DATABASE_URL, adminQuery, ensureBrowserRoles } from './db.js';

const MIGRATION = fs.readFileSync(path.join(SERVER_DIR, '..', 'supabase', 'migrations', '20261104000000_saved_files.sql'), 'utf8');

// The SQL DEPLOYMENT-GUIDE.md contained before this migration existed: what the owner
// most likely ran by hand
const LEGACY_GUIDE_SQL = `
create table public.saved_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null,
  repo_url text,
  content text not null,
  created_at timestamptz not null default now()
);

create index saved_files_user_created_idx on public.saved_files (user_id, created_at desc);

alter table public.saved_files enable row level security;

create policy "Users read own files"   on public.saved_files for select using (auth.uid() = user_id);
create policy "Users insert own files" on public.saved_files for insert with check (auth.uid() = user_id);
create policy "Users delete own files" on public.saved_files for delete using (auth.uid() = user_id);
`;

const USER_A = crypto.randomUUID();
const USER_B = crypto.randomUUID();

const SUPABASE_STUB = `
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key);
create or replace function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema public, auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
insert into auth.users (id) values ('${USER_A}'), ('${USER_B}');
`;

async function freshDatabase() {
  await ensureBrowserRoles();
  const name = `inframind_sf_${crypto.randomBytes(6).toString('hex')}`;
  await adminQuery(`CREATE DATABASE ${name}`);
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${name}`;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  await client.query(SUPABASE_STUB);
  return {
    client,
    async drop() {
      await client.end().catch(() => {});
      await adminQuery(`DROP DATABASE IF EXISTS ${name}`);
    }
  };
}

// Runs fn inside a transaction as `role` with the JWT subject `sub`; always rolls back
async function as(client, role, sub, fn) {
  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL ROLE ${role}`);
    await client.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [sub ?? '']);
    return await fn();
  } finally {
    await client.query('ROLLBACK');
  }
}

const policies = async (client) =>
  (await client.query(`select policyname, cmd, roles::text from pg_policies where tablename = 'saved_files' order by policyname`)).rows;

describe('saved_files migration', { skip: DB_SKIP }, () => {
  let db;
  before(async () => { db = await freshDatabase(); });
  after(async () => { await db?.drop(); });

  test('(a) applies cleanly twice in a row', async () => {
    await db.client.query(MIGRATION);
    await db.client.query(MIGRATION);
    const rls = await db.client.query(`select relrowsecurity from pg_class where oid = 'public.saved_files'::regclass`);
    assert.equal(rls.rows[0].relrowsecurity, true);
    assert.deepEqual(await policies(db.client), [
      { policyname: 'Users delete own files', cmd: 'DELETE', roles: '{authenticated}' },
      { policyname: 'Users insert own files', cmd: 'INSERT', roles: '{authenticated}' },
      { policyname: 'Users read own files', cmd: 'SELECT', roles: '{authenticated}' }
    ]);
    const grants = await db.client.query(`
      select grantee, string_agg(privilege_type, ',' order by privilege_type) as privileges
      from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'saved_files' and grantee in ('anon', 'authenticated')
      group by grantee order by grantee`);
    assert.deepEqual(grants.rows, [{ grantee: 'authenticated', privileges: 'DELETE,INSERT,SELECT' }]);
  });

  test('(b) authenticated users see, add and remove only their own rows', async () => {
    const bRow = (await db.client.query(
      `insert into public.saved_files (user_id, name, type, content) values ($1, 'Dockerfile', 'dockerfile', 'B') returning id`, [USER_B]
    )).rows[0].id;

    await as(db.client, 'authenticated', USER_A, async () => {
      const inserted = await db.client.query(
        `insert into public.saved_files (user_id, name, type, repo_url, content) values ($1, '.env.example', 'env', null, 'A') returning *`, [USER_A]
      );
      assert.equal(inserted.rowCount, 1, 'insert with a returning select, as the client does');
      const visible = await db.client.query(`select user_id from public.saved_files order by created_at desc`);
      assert.deepEqual(visible.rows.map((row) => row.user_id), [USER_A], "B's row is invisible");
      const foreignDelete = await db.client.query(`delete from public.saved_files where id = $1 returning id`, [bRow]);
      assert.equal(foreignDelete.rowCount, 0, "B's row cannot be deleted");
      const ownDelete = await db.client.query(`delete from public.saved_files where id = $1 returning id`, [inserted.rows[0].id]);
      assert.equal(ownDelete.rowCount, 1);
    });

    await as(db.client, 'authenticated', USER_A, async () => {
      await assert.rejects(
        db.client.query(`insert into public.saved_files (user_id, name, type, content) values ($1, 'x', 'x', 'x')`, [USER_B]),
        /row-level security/
      );
    });
    await as(db.client, 'authenticated', USER_B, async () => {
      await assert.rejects(db.client.query(`update public.saved_files set content = 'edited'`), /permission denied/);
    });
    const still = await db.client.query(`select count(*)::int as n from public.saved_files where id = $1`, [bRow]);
    assert.equal(still.rows[0].n, 1);
  });

  test('(c) anon gets nothing', async () => {
    await as(db.client, 'anon', null, async () => {
      await assert.rejects(db.client.query(`select * from public.saved_files`), /permission denied/);
    });
  });
});

describe('saved_files migration over a table created from the old guide SQL', { skip: DB_SKIP }, () => {
  let db;
  before(async () => { db = await freshDatabase(); });
  after(async () => { await db?.drop(); });

  test('(d) succeeds, keeps every existing row and leaves the same three policies', async () => {
    await db.client.query(LEGACY_GUIDE_SQL);
    await db.client.query(
      `insert into public.saved_files (user_id, name, type, repo_url, content) values ($1, 'Dockerfile', 'dockerfile', 'https://github.com/o/r', 'FROM node:22'), ($2, 'ci.yml', 'github-actions', null, 'name: ci')`,
      [USER_A, USER_B]
    );
    const before = (await db.client.query(`select * from public.saved_files order by name`)).rows;

    await db.client.query(MIGRATION);

    const after = (await db.client.query(`select * from public.saved_files order by name`)).rows;
    assert.deepEqual(after, before);
    assert.deepEqual((await policies(db.client)).map((p) => [p.policyname, p.roles]), [
      ['Users delete own files', '{authenticated}'],
      ['Users insert own files', '{authenticated}'],
      ['Users read own files', '{authenticated}']
    ]);
    const indexes = await db.client.query(`select indexname from pg_indexes where tablename = 'saved_files' order by indexname`);
    assert.deepEqual(indexes.rows.map((row) => row.indexname), ['saved_files_pkey', 'saved_files_user_created_idx']);
    await as(db.client, 'authenticated', USER_A, async () => {
      const visible = await db.client.query(`select name from public.saved_files`);
      assert.deepEqual(visible.rows.map((row) => row.name), ['Dockerfile']);
    });
  });
});
