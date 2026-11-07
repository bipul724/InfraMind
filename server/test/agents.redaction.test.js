// Architect review of B2.5: repository text is redacted before it is stored in the
// evidence object (and so before any prompt). redactCredentials is best effort.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { REDACTED, parseRequirementNames, parseTomlDependencyNames, redactCredentials } from '../agents/grounding.js';

const same = (text) => assert.equal(redactCredentials(text), text);

describe('redactCredentials (a): URL userinfo', () => {
  const cases = [
    ['--extra-index-url https://deploy:MARKERSECRET111@pypi.corp.example/simple', '--extra-index-url https://REDACTED@pypi.corp.example/simple'],
    ['privlib @ git+https://' + 'ghp_' + 'MARKERTOKEN222@github.com/org/privlib.git', 'privlib @ git+https://REDACTED@github.com/org/privlib.git'],
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
    ['API: ' + 'sk-' + 'MARKERKEY333', 'API: REDACTED'],
    ['x ' + 'ghp_' + 'abcdefghijklmnop y', 'x REDACTED y'],
    ['github_' + 'pat_' + '11ABC_def', 'REDACTED'],
    ['aws ' + 'AKIA' + 'IOSFODNN7EXAMPLE', 'aws REDACTED'],
    ['slack ' + 'xoxb-' + '123-456', 'slack REDACTED'],
    ['stripe ' + 'sk_' + 'live_' + 'abc123', 'stripe REDACTED']
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

// B2.6 (T-245). Every expected output is compared whole, so the text around each
// credential is proven intact. Markers are fake.
const cases = (rows) => {
  for (const [input, expected] of rows) test(input, () => assert.equal(redactCredentials(input), expected));
};

describe('redactCredentials (c): a quoted Key: value ends at the closing quote', () => {
  cases([
    ['curl -H "X-Api-Key: abcMARKERAPIKEY611" https://x', 'curl -H "X-Api-Key: REDACTED" https://x'],
    ["curl --header 'PRIVATE-TOKEN: glpatMARKERPRIVATE612' https://gitlab.example/api/v4/projects", "curl --header 'PRIVATE-TOKEN: REDACTED' https://gitlab.example/api/v4/projects"],
    ['  - run: curl -H "X-Auth-Token: MARKERAUTH613" -H "Accept: application/json" https://x', '  - run: curl -H "X-Auth-Token: REDACTED" -H "Accept: application/json" https://x']
  ]);
  test('an unquoted Key: value still runs to the end of the line', () => {
    assert.equal(redactCredentials('X-Api-Key: abc MARKERAPIKEY614 x'), 'X-Api-Key: REDACTED');
  });
});

describe('redactCredentials (d): Slack and Discord webhook URLs', () => {
  cases([
    ['curl -X POST https://hooks.slack.com/services/' + 'T0000/B0000/XXXXMARKERSLACK621XXXX', 'curl -X POST https://hooks.slack.com/services/REDACTED'],
    ['SLACK_URL: "https://hooks.slack.com/workflows/' + 'T01/A02/123/MARKERSLACK622"', 'SLACK_URL: "https://hooks.slack.com/workflows/REDACTED"'],
    ['https://discord.com/api/webhooks/' + '123456/abcMARKERDISCORD623', 'https://discord.com/api/webhooks/REDACTED'],
    ['curl -d @msg.json https://discordapp.com/api/webhooks/' + '42/MARKERDISCORD624?wait=true && echo ok', 'curl -d @msg.json https://discordapp.com/api/webhooks/REDACTED && echo ok'],
    ['see (https://hooks.slack.com/services/' + 'T1/B2/MARKERSLACK625) for alerts', 'see (https://hooks.slack.com/services/REDACTED) for alerts']
  ]);
  test('other Slack and Discord URLs, and a bare prefix, stay', () => {
    same('see https://api.slack.com/messaging/webhooks');
    same('https://discord.com/developers/docs/resources/webhook');
    same('https://hooks.slack.com/services/');
  });
  test('a reference in the path stays', () => {
    same('url: https://hooks.slack.com/services/${{ secrets.SLACK_PATH }}');
  });
});

describe('redactCredentials (e): Authorization and Proxy-Authorization headers', () => {
  cases([
    ['run: curl -H "Authorization: Bearer abcDEF1234567890xyzMARKERBEARER631" https://api.example.com', 'run: curl -H "Authorization: Bearer REDACTED" https://api.example.com'],
    ['Authorization: Bearer abcDEF1234567890xyzMARKERBEARER632', 'Authorization: Bearer REDACTED'],
    ["curl -H 'Authorization: token abcDEF1234567890xyzMARKERTOKEN633' x", "curl -H 'Authorization: token REDACTED' x"],
    ['Authorization: Basic dXNlcjpNQVJLRVJCQVNJQzYzNA==', 'Authorization: Basic REDACTED'],
    ['authorization: Bot MARKERBOT635', 'authorization: Bot REDACTED'],
    ['--header="Proxy-Authorization: Digest MARKERDIGEST636" https://x', '--header="Proxy-Authorization: Digest REDACTED" https://x'],
    ['Authorization: MARKERRAW637', 'Authorization: REDACTED'],
    ['  "Authorization": "Bearer MARKERJSON638",', '  "Authorization": "Bearer REDACTED",'],
    ['headers: { Authorization: `Bearer MARKERJS639` }', 'headers: { Authorization: `Bearer REDACTED` }'],
    ['-H "authorization:Bearer MARKERNOSPACE640" x', '-H "authorization:Bearer REDACTED" x']
  ]);
  test('references, a scheme alone and other headers stay', () => {
    same('Authorization: Bearer ${{ secrets.DEPLOY_TOKEN }}');
    same('Authorization: Bearer $TOKEN');
    same('curl -H "Authorization: Bearer ${TOKEN}" https://x');
    same('Authorization: Bearer');
    same('WWW-Authenticate: Bearer realm="api"');
    same('echo "Authorization header required"');
  });
});

describe('redactCredentials (f): Dockerfile ENV and ARG, space form', () => {
  cases([
    ['ENV API_TOKEN abcMARKERENV641', 'ENV API_TOKEN REDACTED'],
    ['ARG DB_PASSWORD hunterMARKERARG642', 'ARG DB_PASSWORD REDACTED'],
    ['  env GITHUB_TOKEN two words MARKERENV643', '  env GITHUB_TOKEN REDACTED'],
    ['FROM node:20\nENV SECRET_KEY MARKERENV644\nENV NODE_ENV production\n', 'FROM node:20\nENV SECRET_KEY REDACTED\nENV NODE_ENV production\n']
  ]);
  test('non-sensitive keys, no value and references stay', () => {
    same('ENV NODE_ENV production');
    same('ENV PATH /usr/local/bin:$PATH');
    same('ARG NPM_TOKEN');
    same('ENV API_TOKEN ${API_TOKEN}');
  });
});

describe('redactCredentials (g): curl and docker login credentials', () => {
  cases([
    ['curl -u admin:hunter2MARKERCURL651 https://x', 'curl -u REDACTED https://x'],
    ['curl --user admin:MARKERCURL652 https://x', 'curl --user REDACTED https://x'],
    ['curl --user=admin:MARKERCURL653 https://x', 'curl --user=REDACTED https://x'],
    ['curl -uadmin:MARKERCURL654 https://x', 'curl -uREDACTED https://x'],
    ['curl -fsS --user "admin:MARKERCURL655" https://x | sh', 'curl -fsS --user "REDACTED" https://x | sh'],
    ['docker login -u me -p hunterMARKERDOCKER656 registry.example.com', 'docker login -u me -p REDACTED registry.example.com'],
    ['docker login --password MARKERDOCKER657 -u me reg', 'docker login --password REDACTED -u me reg'],
    ['docker login --password=MARKERDOCKER658 reg', 'docker login --password=REDACTED reg'],
    ['docker login -p MARKERDOCKER659 reg && docker run -p 8080:80 app', 'docker login -p REDACTED reg && docker run -p 8080:80 app']
  ]);
  test('references, --password-stdin, and -u / -p outside curl and docker login stay', () => {
    same('curl -u ${{ secrets.U }}:${{ secrets.P }} x');
    same('curl -u "$USER:$PASS" x');
    same('docker login -u me --password-stdin registry.example.com');
    same('echo "$PW" | docker login -u me --password-stdin reg');
    same('docker login -p ${{ secrets.REGISTRY_PASSWORD }} reg');
    same('docker run -p 8080:80 app');
    same('mkdir -p dir');
    same('git push -u origin main');
    same('curl --user-agent "x" https://x');
  });
});

describe('redactCredentials (g): commands continued with a backslash (architect review of B2.6)', () => {
  cases([
    ['curl \\\n  -u a:pwMARKERCONT671 \\\n  https://x', 'curl \\\n  -u REDACTED \\\n  https://x'],
    ['docker login \\\n  -p pwMARKERCONT672 ghcr.io', 'docker login \\\n  -p REDACTED ghcr.io'],
    ['docker login \\\n  --password pwMARKERCONT673 \\\n  ghcr.io', 'docker login \\\n  --password REDACTED \\\n  ghcr.io'],
    [
      'jobs:\n  d:\n    steps:\n      - run: |\n          curl -fsS \\\n            -u deploy:pwMARKERCONT674 \\\n            https://api.example.com/deploy\n          echo done\n',
      'jobs:\n  d:\n    steps:\n      - run: |\n          curl -fsS \\\n            -u REDACTED \\\n            https://api.example.com/deploy\n          echo done\n'
    ],
    ['curl -u \\\n  a:pwMARKERCONT675 x', 'curl -u \\\n  REDACTED x'],
    ['curl \\  \r\n  --user a:pwMARKERCONT676 \\\r\n  x\r\n', 'curl \\  \r\n  --user REDACTED \\\r\n  x\r\n']
  ]);
  test('a line that does not end in "\\" is not joined, and ;, &&, || and | still end the command', () => {
    same('curl https://x\n  -u keep:me');
    same('curl -X POST \\\n  https://x && \\\n  sort -u file');
    same('docker login -u me reg; \\\n  docker run -p 80:80 app');
  });
});

describe('redactCredentials (g): curl --oauth2-bearer', () => {
  cases([
    ['curl --oauth2-bearer tokMARKEROAUTH681 https://api.example.com', 'curl --oauth2-bearer REDACTED https://api.example.com'],
    ['curl --oauth2-bearer=tokMARKEROAUTH682 https://x', 'curl --oauth2-bearer=REDACTED https://x']
  ]);
  test('a reference stays', () => same('curl --oauth2-bearer "${{ secrets.API_TOKEN }}" https://x'));
});

describe('B2.6 keep-list: ordinary configuration comes back byte for byte', () => {
  const keep = [
    'docker run -p 8080:80 app',
    'mkdir -p dir',
    'ENV NODE_ENV production',
    'ENV PATH /usr/local/bin:$PATH',
    'ARG NODE_VERSION=20',
    'ARG NPM_TOKEN',
    'ENV API_TOKEN ${API_TOKEN}',
    'Authorization: Bearer ${{ secrets.DEPLOY_TOKEN }}',
    'Authorization: Bearer $TOKEN',
    'curl -u ${{ secrets.U }}:${{ secrets.P }} x',
    'docker login -u me --password-stdin registry.example.com',
    'see https://api.slack.com/messaging/webhooks',
    'requests==2.31.0',
    // Architect review of B2.6: continued commands
    'docker login \\\n  --password-stdin ghcr.io',
    'curl \\\n  --user-agent "x" https://x',
    'docker run \\\n  -p 8080:80 app',
    'mkdir -p a && \\\n  docker run -p 80:80 app'
  ];
  for (const line of keep) test(line, () => same(line));
  test('all of them as one file', () => same(`${keep.join('\n')}\n`));
});

describe('dependency names are unchanged by redaction', () => {
  const requirements = [
    '--extra-index-url https://deploy:MARKERSECRET111@pypi.corp.example/simple',
    'flask==3.0.3',
    'privlib @ git+https://' + 'ghp_' + 'MARKERTOKEN222@github.com/org/privlib.git',
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
