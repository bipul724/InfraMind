// Database-only checks of the migration: RLS, browser-role privileges, columns, checks,
// and an idempotent migrate deploy. Runs only with TEST_DATABASE_URL.
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DB_SKIP, adminQuery, createTestDatabase, runMigrateDeploy } from './db.js';

const TABLES = ['analysis_sessions', 'generated_files', 'ai_calls', '_prisma_migrations'];

describe('migration: database schema', { skip: DB_SKIP }, () => {
  let db;
  const query = (sql, params) => adminQuery(sql, params, db.name);
  before(async () => { db = await createTestDatabase(); });
  after(async () => { await db?.drop(); });

  test('row level security is enabled on all four tables, including _prisma_migrations', async () => {
    const { rows } = await query(
      `SELECT relname, relrowsecurity FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname = ANY($1) ORDER BY relname`,
      [TABLES]
    );
    assert.deepEqual(rows.map((r) => [r.relname, r.relrowsecurity]), [
      ['_prisma_migrations', true], ['ai_calls', true], ['analysis_sessions', true], ['generated_files', true]
    ]);
    const policies = await query(`SELECT count(*)::int AS n FROM pg_policies WHERE tablename = ANY($1)`, [TABLES]);
    assert.equal(policies.rows[0].n, 0, 'no policies: browser roles see nothing');
  });

  test('anon and authenticated have no privileges, although default privileges granted them', async () => {
    // The test database grants ALL on new tables and sequences to both roles, as Supabase does
    for (const role of ['anon', 'authenticated']) {
      for (const table of TABLES) {
        for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
          const { rows } = await query(`SELECT has_table_privilege($1, $2, $3) AS ok`, [role, `public.${table}`, privilege]);
          assert.equal(rows[0].ok, false, `${role} ${privilege} ${table}`);
        }
      }
      const seq = await query(`SELECT has_sequence_privilege($1, 'public.ai_calls_id_seq', 'USAGE') AS ok`, [role]);
      assert.equal(seq.rows[0].ok, false, `${role} usage on ai_calls_id_seq`);
    }
  });

  test('ai_calls has no text column beyond task, provider, model and outcome', async () => {
    const { rows } = await query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'ai_calls'
         AND data_type IN ('text', 'character varying', 'character', 'json', 'jsonb', 'bytea')
       ORDER BY column_name`
    );
    assert.deepEqual(rows.map((r) => r.column_name), ['model', 'outcome', 'provider', 'task']);
    const identity = await query(`SELECT identity_generation FROM information_schema.columns WHERE table_name = 'ai_calls' AND column_name = 'id'`);
    assert.equal(identity.rows[0].identity_generation, 'ALWAYS');
  });

  test('no column stores a filesystem path', async () => {
    const { rows } = await query(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ANY($1) AND column_name ILIKE '%path%'`,
      [TABLES]
    );
    assert.deepEqual(rows, []);
  });

  test('the status and content-length checks reject bad rows', async () => {
    const id = crypto.randomUUID();
    const insert = (status) => query(
      `INSERT INTO analysis_sessions (id, user_id, owner, repo, full_name, repo_name, display_url, status, expires_at)
       VALUES ($1, $2, 'o', 'r', 'o/r', 'r', 'https://github.com/o/r', $3, now() + interval '1 day')`,
      [status === 'cloning' ? id : crypto.randomUUID(), crypto.randomUUID(), status]
    );
    await assert.rejects(insert('hacked'), /analysis_sessions_status_check/);
    await insert('cloning');
    await assert.rejects(
      query(`INSERT INTO generated_files (session_id, kind, content) VALUES ($1, 'dockerfile', repeat('x', 200001))`, [id]),
      /generated_files_content_length_check/
    );
    await query(`INSERT INTO generated_files (session_id, kind, content) VALUES ($1, 'dockerfile', repeat('x', 200000))`, [id]);
    await assert.rejects(
      query(`INSERT INTO ai_calls (id, task, provider, model, outcome, attempt, latency_ms) VALUES (1, 't', 'p', 'm', 'ok', 1, 1)`),
      /cannot insert a non-DEFAULT value into column "id"/,
      'ids are always generated'
    );
  });

  test('re-running migrate deploy is a no-op', async () => {
    const before = await query(`SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY migration_name`);
    const result = await runMigrateDeploy(db.url);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /No pending migrations to apply/);
    const after = await query(`SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY migration_name`);
    assert.deepEqual(after.rows, before.rows);
    assert.equal(after.rows.length, 1);
  });
});
