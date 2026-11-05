// Live smoke test of every configured AI provider. For the owner, against real providers:
//   RUN_LIVE_AI=1 npm run ai:smoke
// Each provider in any route gets one tiny generateText and one tiny generateObject call,
// independently of the fallback chain. Prints outcomes, HTTP status and latency only:
// never content, keys or URLs. Exits 1 if any provider failed.
// RUN_LIVE_AI must come from the command line: it is checked before .env is loaded,
// so a value in .env can never start live traffic, and a refusal never reads .env
if (process.env.RUN_LIVE_AI !== '1') {
  console.error('Refusing to run: this sends real requests to the configured AI providers. Set RUN_LIVE_AI=1 to confirm.');
  process.exit(1);
}

await import('dotenv/config');
const { z } = await import('zod');
const { AiConfigError, AiError, createAiClient, loadAiConfig, TASKS } = await import('../ai/index.js');

let config;
try {
  config = loadAiConfig(process.env);
} catch (error) {
  if (!(error instanceof AiConfigError)) throw error;
  for (const problem of error.problems) console.error(`config: ${problem}`);
  process.exit(1);
}

const providers = [...new Set(TASKS.flatMap((task) => config.routes[task]))];
const okSchema = z.object({ ok: z.boolean() });

// Runs one call against one provider only; returns a printable summary from the call records
async function probe(name, run) {
  const records = [];
  const single = Object.freeze({
    ...config,
    routes: Object.freeze(Object.fromEntries(TASKS.map((task) => [task, Object.freeze([name])])))
  });
  const client = createAiClient({ config: single, fetch: (...args) => globalThis.fetch(...args), onCall: (record) => records.push(record) });
  const started = Date.now();
  let ok = true;
  try {
    await run(client);
  } catch (error) {
    if (!(error instanceof AiError)) throw error;
    ok = false;
  }
  const last = records.at(-1);
  const outcomes = records.map((r) => r.outcome).join(',') || 'none';
  return {
    ok,
    text: `${ok ? 'ok' : 'FAILED'} (outcomes=${outcomes} http_status=${last?.httpStatus ?? '-'} latency_ms=${Date.now() - started})`
  };
}

let failed = false;
for (const name of providers) {
  const provider = config.providers[name];
  const text = await probe(name, (client) =>
    client.generateText({ task: 'verifier', system: 'You are a health check.', prompt: 'Reply with the single word: pong', maxTokens: 1024 })
  );
  const json = await probe(name, (client) =>
    client.generateObject({
      task: 'verifier',
      system: 'You are a health check.',
      prompt: 'Return {"ok": true}.',
      schema: okSchema,
      schemaName: 'health_check',
      // Reasoning models spend output tokens on reasoning first; small caps leave no content
      maxTokens: 1024
    })
  );
  if (!text.ok || !json.ok) failed = true;
  console.log(`${name} (model ${provider.model}):`);
  console.log(`  text: ${text.text}`);
  console.log(`  json (${provider.jsonMode}): ${json.text}${json.ok ? '' : ` -> try another ${name.toUpperCase()}_JSON_MODE`}`);
}

process.exit(failed ? 1 : 0);
