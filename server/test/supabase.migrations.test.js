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
    url: url.toString(),
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

describe('saved_files baseline before the limits migration', { skip: DB_SKIP }, () => {
  let db;
  before(async () => { db = await freshDatabase(); await db.client.query(MIGRATION); });
  after(async () => { await db?.drop(); });

  test('B4.5 baseline has no user default, shape checks or unique file constraint', async () => {
    const column = await db.client.query(`select column_default from information_schema.columns where table_schema = 'public' and table_name = 'saved_files' and column_name = 'user_id'`);
    assert.equal(column.rows[0].column_default, null);
    const constraints = await db.client.query(`select contype from pg_constraint where conrelid = 'public.saved_files'::regclass order by contype`);
    assert.deepEqual(constraints.rows.map((row) => row.contype), ['f', 'p']);
    console.log('B4.5 saved_files baseline:', JSON.stringify({ userIdDefault: column.rows[0].column_default, constraintTypes: constraints.rows.map((row) => row.contype) }));
  });

  test('B4.5 baseline authenticated user A can save the same three files twice', async () => {
    await as(db.client, 'authenticated', USER_A, async () => {
      for (let copy = 0; copy < 2; copy++) {
        await db.client.query(`insert into public.saved_files (user_id, name, type, repo_url, content) values ($1, 'Dockerfile', 'dockerfile', 'https://github.com/a/repo', 'FROM node:22'), ($1, 'ci.yml', 'github-actions', 'https://github.com/a/repo', 'name: ci'), ($1, '.env.example', 'env', 'https://github.com/a/repo', 'PORT=3000')`, [USER_A]);
      }
      const count = await db.client.query(`select count(*)::int as n from public.saved_files`);
      assert.equal(count.rows[0].n, 6);
      const checklist = fs.readFileSync(path.join(SERVER_DIR, '..', 'PRODUCTION-CHECKLIST.md'), 'utf8');
      const documentedQuery = checklist.match(/```sql\n([\s\S]*?)\n```/);
      assert.ok(documentedQuery);
      const duplicates = Number((await db.client.query(documentedQuery[1])).rows[0].duplicate_rows_to_remove);
      assert.equal(duplicates, 3);
      assert.equal((await db.client.query(`select count(*)::int as n from public.saved_files`)).rows[0].n, 6);
      console.log('B4.5 duplicate baseline authenticated A:', JSON.stringify({ rows: count.rows[0].n, duplicateRowsToRemove: duplicates }));
    });
  });

  test('B4.5 baseline authenticated user A can insert 1000 rows and a 5 MB file', async () => {
    await as(db.client, 'authenticated', USER_A, async () => {
      await db.client.query(`insert into public.saved_files (user_id, name, type, content) select $1, 'baseline-' || n, 'dockerfile', 'fixture' from generate_series(1, 1000) n`, [USER_A]);
      await db.client.query(`insert into public.saved_files (user_id, name, type, content) values ($1, 'oversized', 'dockerfile', repeat('x', 5 * 1024 * 1024))`, [USER_A]);
      const measured = await db.client.query(`select count(*)::int as rows, max(octet_length(content)) as maximum_bytes from public.saved_files`);
      assert.deepEqual(measured.rows, [{ rows: 1001, maximum_bytes: 5242880 }]);
      console.log('B4.5 size/cap baseline authenticated A:', JSON.stringify(measured.rows[0]));
    });
  });
});

const LIMITS_MIGRATION_PATH = path.join(SERVER_DIR, '..', 'supabase', 'migrations', '20261106000000_saved_files_limits.sql');
// Execute the owner's documented query so its duplicate count stays aligned with the migration.
const duplicateCountQuery = () => {
  const checklist = fs.readFileSync(path.join(SERVER_DIR, '..', 'PRODUCTION-CHECKLIST.md'), 'utf8');
  const query = checklist.match(/```sql\n([\s\S]*?)\n```/);
  assert.ok(query, 'the production checklist includes the read-only duplicate query');
  return query[1];
};
const limitsMigration = () => fs.readFileSync(LIMITS_MIGRATION_PATH, 'utf8');

async function limitsDatabase(seed) {
  const db = await freshDatabase();
  try {
    await db.client.query(MIGRATION);
    if (seed) await seed(db.client);
    await db.client.query(limitsMigration());
    return db;
  } catch (error) {
    await db.drop();
    throw error;
  }
}

const grantsFor = async (client) => (await client.query(`
  select grantee, string_agg(privilege_type, ',' order by privilege_type) as privileges
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'saved_files' and grantee in ('anon', 'authenticated')
  group by grantee order by grantee`)).rows;

async function asCommitted(client, sub, fn) {
  await client.query('BEGIN');
  try {
    await client.query('SET LOCAL ROLE authenticated');
    await client.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [sub]);
    const result = await fn();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

describe('saved_files limits migration', { skip: DB_SKIP }, () => {
  test('(e) is idempotent and preserves RLS, grants, checks and trigger privileges', async () => {
    const db = await limitsDatabase();
    try {
      const beforePolicies = await policies(db.client);
      const beforeGrants = await grantsFor(db.client);
      const constraints = async () => (await db.client.query(`select conname, contype, convalidated, pg_get_constraintdef(oid) as definition from pg_constraint where conrelid = 'public.saved_files'::regclass order by conname`)).rows;
      const beforeConstraints = await constraints();
      await db.client.query(limitsMigration());
      assert.deepEqual(await policies(db.client), beforePolicies);
      assert.deepEqual(await grantsFor(db.client), beforeGrants);
      assert.deepEqual(beforeGrants, [{ grantee: 'authenticated', privileges: 'DELETE,INSERT,SELECT' }]);
      assert.deepEqual(await constraints(), beforeConstraints);
      assert.equal(beforeConstraints.filter((row) => row.contype === 'c').length, 4);
      assert.ok(beforeConstraints.filter((row) => row.contype === 'c').every((row) => !row.convalidated));
      assert.ok(beforeConstraints.some((row) => row.conname === 'saved_files_unique_file' && row.definition.includes('NULLS NOT DISTINCT')));
      const functions = await db.client.query(`select p.prosecdef, p.proconfig, has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute, has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute from pg_proc p where p.oid = 'public.enforce_saved_files_limit()'::regprocedure`);
      assert.deepEqual(functions.rows, [{ prosecdef: false, proconfig: ['search_path=""'], anon_execute: false, authenticated_execute: false }]);
      const column = await db.client.query(`select is_generated, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'saved_files' and column_name = 'content_sha256'`);
      assert.deepEqual(column.rows, [{ is_generated: 'NEVER', is_nullable: 'NO' }]);
      const triggers = await db.client.query(`select tgname from pg_trigger where tgrelid = 'public.saved_files'::regclass and not tgisinternal`);
      assert.deepEqual(triggers.rows, [{ tgname: 'saved_files_limit_before_insert' }]);
    } finally { await db.drop(); }
  });

  test('(f) user_id defaults to authenticated A and the insert policy still refuses B', async () => {
    const db = await limitsDatabase();
    try {
      await as(db.client, 'authenticated', USER_A, async () => {
        const inserted = await db.client.query(`insert into public.saved_files (name, type, content) values ('Dockerfile', 'dockerfile', 'A') returning user_id`);
        assert.deepEqual(inserted.rows, [{ user_id: USER_A }]);
      });
      await as(db.client, 'authenticated', USER_A, async () => {
        await assert.rejects(db.client.query(`insert into public.saved_files (user_id, name, type, content) values ($1, 'Dockerfile', 'dockerfile', 'B')`, [USER_B]), (error) => error.code === '42501' && /row-level security/.test(error.message));
      });
    } finally { await db.drop(); }
  });

  test('(g) checks reject bad new rows, accept exact boundaries and keep oversized existing rows', async () => {
    let legacyId;
    const db = await limitsDatabase(async (client) => {
      legacyId = (await client.query(`insert into public.saved_files (user_id, name, type, content) values ($1, 'legacy oversized', 'dockerfile', repeat('x', 100001)) returning id`, [USER_A])).rows[0].id;
    });
    try {
      await db.client.query(limitsMigration());
      const existing = await db.client.query(`select octet_length(content) as bytes from public.saved_files where id = $1`, [legacyId]);
      assert.deepEqual(existing.rows, [{ bytes: 100001 }]);
      const bad = [
        ['', 'dockerfile', null, 'valid', 'saved_files_name_length_check'],
        ['n'.repeat(256), 'dockerfile', null, 'valid', 'saved_files_name_length_check'],
        ['bad type', 'other', null, 'valid', 'saved_files_type_check'],
        ['bad url', 'dockerfile', 'x'.repeat(2049), 'valid', 'saved_files_repo_url_length_check'],
        ['bad bytes', 'dockerfile', null, 'x'.repeat(100001), 'saved_files_content_size_check'],
        ['bad UTF8 bytes', 'dockerfile', null, 'é'.repeat(50000) + 'x', 'saved_files_content_size_check']
      ];
      for (const [name, type, repo, content, constraint] of bad) {
        await as(db.client, 'authenticated', USER_A, async () => {
          await assert.rejects(db.client.query(`insert into public.saved_files (name, type, repo_url, content) values ($1, $2, $3, $4)`, [name, type, repo, content]), (error) => error.code === '23514' && error.constraint === constraint);
        });
      }
      const good = [
        ['n'.repeat(255), 'dockerfile', null, 'valid'],
        ['exact url', 'github-actions', 'x'.repeat(2048), 'valid'],
        ['exact bytes', 'env', null, 'x'.repeat(100000)],
        ['exact UTF8 bytes', 'env', null, 'é'.repeat(50000)]
      ];
      for (const row of good) {
        await as(db.client, 'authenticated', USER_A, async () => {
          const inserted = await db.client.query(`insert into public.saved_files (name, type, repo_url, content) values ($1, $2, $3, $4) returning content_sha256`, row);
          assert.equal(inserted.rowCount, 1);
          assert.equal(inserted.rows[0].content_sha256, crypto.createHash('sha256').update(row[3], 'utf8').digest('hex'));
        });
      }
    } finally { await db.drop(); }
  });

  test('(h) A can insert row 500, is refused at 501, and B can still insert', async () => {
    const db = await limitsDatabase();
    try {
      await as(db.client, 'authenticated', USER_A, async () => {
        await db.client.query(`insert into public.saved_files (name, type, content) select 'cap-' || n, 'dockerfile', 'fixture' from generate_series(1, 499) n`);
        const last = await db.client.query(`insert into public.saved_files (name, type, content) values ('cap-500', 'dockerfile', 'fixture') returning id`);
        assert.equal(last.rowCount, 1);
        await db.client.query('SAVEPOINT over_cap');
        await assert.rejects(db.client.query(`insert into public.saved_files (name, type, content) values ('cap-501', 'dockerfile', 'fixture')`), (error) => error.code === '23514' && error.message === 'saved_files limit reached (500 per user)');
        await db.client.query('ROLLBACK TO SAVEPOINT over_cap');
        await db.client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [USER_B]);
        const own = await db.client.query(`insert into public.saved_files (name, type, content) values ('B first', 'dockerfile', 'fixture') returning user_id`);
        assert.deepEqual(own.rows, [{ user_id: USER_B }]);
      });
    } finally { await db.drop(); }
  });

  test('(h) the table owner enforces the cap per user without RLS', async () => {
    const db = await limitsDatabase();
    try {
      const writer = await db.client.query(`select current_user = pg_catalog.pg_get_userbyid(relowner) as is_owner from pg_catalog.pg_class where oid = 'public.saved_files'::regclass`);
      assert.equal(writer.rows[0].is_owner, true, 'the connection is the table owner, without SET ROLE');
      const seeded = await db.client.query(`insert into public.saved_files (user_id, name, type, content) select $1, 'owner-B-' || n, 'dockerfile', 'fixture' from generate_series(1, 500) n returning id`, [USER_B]);
      assert.equal(seeded.rowCount, 500);

      const own = await db.client.query(`insert into public.saved_files (user_id, name, type, content) values ($1, 'owner-A-first', 'dockerfile', 'fixture') returning user_id`, [USER_A]);
      assert.deepEqual(own.rows, [{ user_id: USER_A }], "B's 500 rows do not block an owner insert for A");
      await assert.rejects(
        db.client.query(`insert into public.saved_files (user_id, name, type, content) values ($1, 'owner-B-501', 'dockerfile', 'fixture')`, [USER_B]),
        (error) => error.code === '23514' && error.message === 'saved_files limit reached (500 per user)'
      );
      const counts = await db.client.query(`select user_id, count(*)::int as n from public.saved_files group by user_id`);
      assert.deepEqual(Object.fromEntries(counts.rows.map((row) => [row.user_id, row.n])), { [USER_A]: 1, [USER_B]: 500 });
    } finally { await db.drop(); }
  });

  test('(i) conflict-ignore de-duplicates per user, including null URLs, and keeps changed content', async () => {
    const db = await limitsDatabase();
    try {
      await as(db.client, 'authenticated', USER_A, async () => {
        const same = await db.client.query(`insert into public.saved_files (name, type, repo_url, content) values ('Dockerfile', 'dockerfile', 'https://github.com/a/repo', 'FROM node:22'), ('Dockerfile', 'dockerfile', 'https://github.com/a/repo', 'FROM node:22') on conflict on constraint saved_files_unique_file do nothing returning id`);
        assert.equal(same.rowCount, 1);
        const nullUrl = await db.client.query(`insert into public.saved_files (name, type, content) values ('.env.example', 'env', 'PORT=3000'), ('.env.example', 'env', 'PORT=3000') on conflict on constraint saved_files_unique_file do nothing returning id`);
        assert.equal(nullUrl.rowCount, 1);
        const changed = await db.client.query(`insert into public.saved_files (name, type, repo_url, content) values ('changed', 'dockerfile', null, 'one'), ('changed', 'dockerfile', null, 'two') on conflict on constraint saved_files_unique_file do nothing returning id`);
        assert.equal(changed.rowCount, 2);
      });
      await as(db.client, 'authenticated', USER_A, async () => {
        const inferred = await db.client.query(`insert into public.saved_files (name, type, repo_url, content, content_sha256) values ('inferred', 'env', null, 'PORT=3000', 'spoof-one'), ('inferred', 'env', null, 'PORT=3000', 'spoof-two') on conflict (user_id, name, repo_url, content_sha256) do nothing returning content_sha256`);
        assert.equal(inferred.rowCount, 1, 'the PostgREST column-list conflict target ignores duplicate files');
        assert.equal(inferred.rows[0].content_sha256, crypto.createHash('sha256').update('PORT=3000', 'utf8').digest('hex'), 'the trigger replaces client-supplied hashes');
      });
      for (const user of [USER_A, USER_B]) {
        await asCommitted(db.client, user, async () => {
          const inserted = await db.client.query(`insert into public.saved_files (name, type, content) values ('same across users', 'dockerfile', 'shared') on conflict on constraint saved_files_unique_file do nothing returning id`);
          assert.equal(inserted.rowCount, 1);
        });
      }
      const both = await db.client.query(`select count(*)::int as n from public.saved_files where name = 'same across users'`);
      assert.equal(both.rows[0].n, 2);
    } finally { await db.drop(); }
  });

  test('(j) the read-only count matches deletion and the earliest timestamp/id copies survive', async () => {
    const expected = [1, 3, 6, 7, 8].map((n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`);
    let counted;
    const db = await limitsDatabase(async (client) => {
      await client.query(`insert into public.saved_files (id, user_id, name, type, repo_url, content, created_at) values
        ('00000000-0000-4000-8000-000000000001', $1, 'Dockerfile', 'dockerfile', 'https://github.com/a/repo', 'FROM node:22', '2020-01-01'),
        ('00000000-0000-4000-8000-000000000002', $1, 'Dockerfile', 'dockerfile', 'https://github.com/a/repo', 'FROM node:22', '2020-01-02'),
        ('00000000-0000-4000-8000-000000000003', $1, '.env.example', 'env', null, 'PORT=3000', '2020-01-03'),
        ('00000000-0000-4000-8000-000000000004', $1, '.env.example', 'env', null, 'PORT=3000', '2020-01-03'),
        ('00000000-0000-4000-8000-000000000005', $1, '.env.example', 'env', null, 'PORT=3000', '2020-01-03'),
        ('00000000-0000-4000-8000-000000000006', $2, 'Dockerfile', 'dockerfile', 'https://github.com/a/repo', 'FROM node:22', '2020-01-01'),
        ('00000000-0000-4000-8000-000000000007', $1, 'Dockerfile', 'dockerfile', 'https://github.com/a/repo', 'FROM node:24', '2020-01-01'),
        ('00000000-0000-4000-8000-000000000008', $1, 'Dockerfile', 'dockerfile', 'https://github.com/a/other', 'FROM node:22', '2020-01-01')`, [USER_A, USER_B]);
      const beforeCount = (await client.query(`select count(*)::int as n from public.saved_files`)).rows[0].n;
      counted = Number((await client.query(duplicateCountQuery())).rows[0].duplicate_rows_to_remove);
      assert.equal(counted, 3);
      assert.equal((await client.query(`select count(*)::int as n from public.saved_files`)).rows[0].n, beforeCount);
    });
    try {
      const remaining = (await db.client.query(`select id from public.saved_files order by id`)).rows.map((row) => row.id);
      assert.deepEqual(remaining, expected);
      assert.equal(8 - remaining.length, counted);
      assert.equal(Number((await db.client.query(duplicateCountQuery())).rows[0].duplicate_rows_to_remove), 0);
    } finally { await db.drop(); }
  });

  test('(k) RLS still hides B from A, forbids foreign deletes and denies anon', async () => {
    const db = await limitsDatabase();
    try {
      await asCommitted(db.client, USER_B, async () => {
        await db.client.query(`insert into public.saved_files (name, type, content) values ('B private', 'dockerfile', 'private')`);
      });
      await as(db.client, 'authenticated', USER_A, async () => {
        assert.equal((await db.client.query(`select * from public.saved_files`)).rowCount, 0);
        assert.equal((await db.client.query(`delete from public.saved_files where user_id = $1 returning id`, [USER_B])).rowCount, 0);
      });
      for (const statement of ['select * from public.saved_files', 'delete from public.saved_files', "insert into public.saved_files (name, type, content) values ('anon', 'env', '')"]) {
        await as(db.client, 'anon', null, async () => {
          await assert.rejects(db.client.query(statement), (error) => error.code === '42501');
        });
      }
      assert.equal((await db.client.query(`select * from public.saved_files where user_id = $1`, [USER_B])).rowCount, 1);
    } finally { await db.drop(); }
  });

  test('(d follow-up) the old guide table keeps all nonduplicate existing rows through both migrations', async () => {
    const db = await freshDatabase();
    try {
      await db.client.query(LEGACY_GUIDE_SQL);
      await db.client.query(`insert into public.saved_files (user_id, name, type, content) values ($1, 'Dockerfile', 'dockerfile', 'FROM node:22'), ($2, 'ci.yml', 'github-actions', 'name: ci')`, [USER_A, USER_B]);
      const projection = 'id, user_id, name, type, repo_url, content, created_at';
      const before = (await db.client.query(`select ${projection} from public.saved_files order by id`)).rows;
      await db.client.query(MIGRATION);
      await db.client.query(limitsMigration());
      await db.client.query(limitsMigration());
      assert.deepEqual((await db.client.query(`select ${projection} from public.saved_files order by id`)).rows, before);
      assert.deepEqual(await grantsFor(db.client), [{ grantee: 'authenticated', privileges: 'DELETE,INSERT,SELECT' }]);
    } finally { await db.drop(); }
  });
});

describe('saved_files concurrent cap', { skip: DB_SKIP }, () => {
  test('serializes two writers competing for the last slot', { timeout: 10000 }, async () => {
    const db = await limitsDatabase();
    const first = new pg.Client({ connectionString: db.url });
    const second = new pg.Client({ connectionString: db.url });
    try {
      await asCommitted(db.client, USER_A, async () => {
        await db.client.query(`insert into public.saved_files (name, type, content) select 'seed-' || n, 'dockerfile', 'fixture' from generate_series(1, 499) n`);
      });
      await first.connect();
      await second.connect();
      for (const client of [first, second]) {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE authenticated');
        await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [USER_A]);
      }
      await first.query(`insert into public.saved_files (name, type, content) values ('writer-one', 'dockerfile', 'fixture')`);
      const pending = second.query(`insert into public.saved_files (name, type, content) values ('writer-two', 'dockerfile', 'fixture')`).then(() => null, (error) => error);
      const deadline = Date.now() + 2000;
      let waiting = false;
      while (!waiting && Date.now() < deadline) {
        waiting = (await db.client.query(`select exists (select 1 from pg_locks where pid = $1 and locktype = 'advisory' and not granted) as waiting`, [second.processID])).rows[0].waiting;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(waiting, true, 'the second insert waits on the first user transaction');
      await first.query('COMMIT');
      const error = await pending;
      assert.equal(error?.code, '23514');
      assert.equal(error?.message, 'saved_files limit reached (500 per user)');
      await second.query('ROLLBACK');
      const count = await db.client.query(`select count(*)::int as n from public.saved_files where user_id = $1`, [USER_A]);
      assert.equal(count.rows[0].n, 500);
    } finally {
      await first.end().catch(() => {});
      await second.end().catch(() => {});
      await db.drop();
    }
  });
});
