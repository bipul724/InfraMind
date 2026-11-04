// Architect review of B2.5: repository text is redacted before it is stored in the
// evidence object (and so before any prompt). redactCredentials is best effort.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { REDACTED, parseRequirementNames, parseTomlDependencyNames, redactCredentials } from '../agents/grounding.js';

const same = (text) => assert.equal(redactCredentials(text), text);

describe('redactCredentials (a): URL userinfo', () => {
  const cases = [
    ['--extra-index-url https://deploy:MARKERSECRET111@pypi.corp.example/simple', '--extra-index-url https://REDACTED@pypi.corp.example/simple'],
    ['privlib @ git+https://ghp_MARKERTOKEN222@github.com/org/privlib.git', 'privlib @ git+https://REDACTED@github.com/org/privlib.git'],
    // No password: a token in the user position looks the same, so it is redacted too
    ['https://user@host.example/x', 'https://REDACTED@host.example/x'],
    ['--index-url=https://u:p%40ss@pypi.example/simple', '--index-url=https://REDACTED@pypi.example/simple'],
    ['ssh://deploy:hunter2@host.example/repo.git', 'ssh://REDACTED@host.example/repo.git'],
    ['url = "postgres://app:pw@db.example:5432/app"', 'url = "postgres://REDACTED@db.example:5432/app"']
  ];
  for (const [input, expected] of cases) test(input, () => assert.equal(redactCredentials(input), expected));

  test('an SSH user name alone stays: git+ssh://git@github.com/... and ssh://git@...', () => {
    same('pkg @ git+ssh://git@github.com/org/repo.git@v1.2.0');
    same('ssh://git@gitlab.example/org/repo.git');
  });
  test('URLs without userinfo, scp-style remotes and e-mail addresses stay', () => {
    same('https://pypi.org/simple\ngit@github.com:org/repo.git\nauthor = "a@b.example"\n"@scope/pkg": "^1.0.0"');
  });
});

describe('redactCredentials (b): the secret patterns of agents/files.js', () => {
  const cases = [
    ['API: sk-MARKERKEY333', 'API: REDACTED'],
    ['x ghp_abcdefghijklmnop y', 'x REDACTED y'],
    ['github_pat_11ABC_def', 'REDACTED'],
    ['aws AKIAIOSFODNN7EXAMPLE', 'aws REDACTED'],
    ['slack xoxb-123-456', 'slack REDACTED'],
    ['stripe sk_live_abc123', 'stripe REDACTED']
  ];
  for (const [input, expected] of cases) test(input, () => assert.equal(redactCredentials(input), expected));

  test('a private key block is removed whole', () => {
    const key = 'before\n-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\nPEMBODYMARKER\n-----END RSA PRIVATE KEY-----\nafter';
    assert.equal(redactCredentials(key), `before\n${REDACTED}\nafter`);
  });
  test('names that only contain the letters stay', () => {
    same('scikit-learn==1.5\ndisk-cache\ntask-runner');
  });
  test('known over-redaction: any token the shared sk- pattern matches, even in a URL path', () => {
    assert.equal(redactCredentials('https://host.example/sk-learn/'), 'https://host.example/REDACTED/');
  });
});

describe('redactCredentials (c): sensitive assignments', () => {
  const cases = [
    ['API_KEY=abc123', 'API_KEY=REDACTED'],
    ['Api_Key=abc123', 'Api_Key=REDACTED'],
    ['      GITHUB_TOKEN: abc123', '      GITHUB_TOKEN: REDACTED'],
    ['db_password: my secret pass  # comment', 'db_password: REDACTED  # comment'],
    ['password = "hunter2"', 'password = "REDACTED"'],
    ["client_secret: 'x y'", "client_secret: 'REDACTED'"],
    ['PRIVATE_KEY=abc', 'PRIVATE_KEY=REDACTED'],
    ['DB_PASSWD=abc', 'DB_PASSWD=REDACTED'],
    ['  "apiKey": "abc",', '  "apiKey": "REDACTED",'],
    ['  "authToken": 12345,', '  "authToken": "REDACTED",'],
    ['RUN API_TOKEN=abc PASSWORD=def make', 'RUN API_TOKEN=REDACTED PASSWORD=REDACTED make'],
    ['"start": "API_TOKEN=abc node server.js"', '"start": "API_TOKEN=REDACTED node server.js"'],
    ['https://api.example/v1?access_token=abc&x=1', 'https://api.example/v1?access_token=REDACTED&x=1'],
    ['  - SECRET_KEY=abc', '  - SECRET_KEY=REDACTED']
  ];
  for (const [input, expected] of cases) test(input, () => assert.equal(redactCredentials(input), expected));

  test('references stay: ${{ secrets.X }}, ${VAR}, $VAR', () => {
    same('token: ${{ secrets.X }}');
    same('API_KEY: "${{ secrets.OPENAI_API_KEY }}"');
    same('API_KEY: ${API_KEY}');
    same('API_KEY=$API_KEY');
    same('PASSWORD=${DB_PASSWORD:-}');
  });
  test('empty values stay empty: API_KEY: "" and API_KEY=', () => {
    same('API_KEY: ""');
    same("API_KEY: ''");
    same('API_KEY=');
    same('API_KEY:');
  });
  test('non-sensitive keys, YAML structure and dependency versions stay', () => {
    same('NAME=value\nport: 8080');
    same('secrets: inherit\npassword: |');
    same('secretstorage==3.3\ntokenizers>=0.15\ntiktoken~=0.7\npython-jose; extra == "jwt"');
    same('"jsonwebtoken": "^9.0.2",\n"@octokit/auth-token": "latest",\n"secret-pkg": "github:org/secret-pkg"');
    same('secretstorage = "^3.3"\ntokenizers = { version = "^0.15", optional = true }');
  });
});

describe('dependency names are unchanged by redaction', () => {
  const requirements = [
    '--extra-index-url https://deploy:MARKERSECRET111@pypi.corp.example/simple',
    'flask==3.0.3',
    'privlib @ git+https://ghp_MARKERTOKEN222@github.com/org/privlib.git',
    'secretstorage==3.3 ; sys_platform == "linux"',
    'tokenizers>=0.15',
    'gunicorn',
    'pkg @ git+ssh://git@github.com/org/pkg.git'
  ].join('\n');
  const pyproject = [
    '[project]',
    'dependencies = ["fastapi>=0.110", "uvicorn[standard]", "privlib @ git+https://u:p@git.example/privlib"]',
    '[tool.poetry.dependencies]',
    'secretstorage = "^3.3"',
    'tokenizers = { version = "^0.15" }',
    '[tool.something]',
    'api_token = "abc"'
  ].join('\n');

  test('requirements.txt', () => {
    const names = parseRequirementNames(requirements);
    assert.deepEqual(names, ['flask', 'privlib', 'secretstorage', 'tokenizers', 'gunicorn', 'pkg']);
    assert.deepEqual(parseRequirementNames(redactCredentials(requirements)), names);
  });
  test('pyproject.toml', () => {
    const names = parseTomlDependencyNames(pyproject);
    assert.deepEqual(names, ['fastapi', 'uvicorn', 'privlib', 'secretstorage', 'tokenizers']);
    assert.deepEqual(parseTomlDependencyNames(redactCredentials(pyproject)), names);
  });
  test('hosts and versions survive', () => {
    const redacted = redactCredentials(requirements);
    for (const kept of ['pypi.corp.example/simple', 'github.com/org/privlib.git', 'flask==3.0.3', 'secretstorage==3.3', 'git@github.com/org/pkg.git']) {
      assert.ok(redacted.includes(kept), kept);
    }
    for (const marker of ['MARKERSECRET111', 'MARKERTOKEN222']) assert.ok(!redacted.includes(marker));
  });
});
