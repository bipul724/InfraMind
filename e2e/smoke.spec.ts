import fs from 'node:fs';
import { test as base, expect, type Page } from '@playwright/test';

interface HarnessState {
  origin: string;
  serverOrigin: string;
  authOrigin: string;
  sessionId: string;
  marker: string;
}

function state(): HarnessState {
  const filename = process.env.INFRAMIND_E2E_STATE;
  if (!filename) throw new Error('Global setup did not provide its fixture state');
  return JSON.parse(fs.readFileSync(filename, 'utf8'));
}

const test = base.extend({
  page: async ({ page }, use, testInfo) => {
    const blocked: string[] = [];
    // Deny every off-machine request before navigation, including fonts and profile images.
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === '127.0.0.1') return route.continue();
      blocked.push(route.request().url());
      return route.abort('blockedbyclient');
    });
    await page.routeWebSocket('**/*', (route) => {
      if (new URL(route.url()).hostname === '127.0.0.1') route.connectToServer();
      else { blocked.push(route.url()); route.close(); }
    });
    await use(page);
    const unique = [...new Set(blocked)].sort();
    console.log(`Blocked external requests [${testInfo.title}]: ${JSON.stringify(unique)}`);
    await testInfo.attach('blocked-external-requests', { body: JSON.stringify(unique, null, 2), contentType: 'application/json' });
  }
});

async function signIn(page: Page, user: 'a' | 'b' = 'a') {
  await page.getByLabel('Email', { exact: true }).fill(`user-${user}@example.test`);
  await page.getByLabel('Password', { exact: true }).fill(`pw-${user}`);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
}

async function enterDashboard(page: Page, user: 'a' | 'b' = 'a') {
  await page.goto(`${state().origin}/auth`);
  await signIn(page, user);
  await expect(page).toHaveURL(`${state().origin}/dashboard`);
  await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible();
}

async function expectDone(page: Page) {
  for (const title of ['Analyzer Agent', 'Generator Agent', 'Verifier Agent']) {
    const card = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
    await expect(card.getByText('Done', { exact: true })).toBeVisible();
  }
}

test('1. email sign-in reaches the dashboard without a GitHub connection', async ({ page }) => {
  await enterDashboard(page);
  await expect(page.locator('header').getByRole('button', { name: 'Connect GitHub', exact: true })).toBeVisible();
});

test('2. a full public run completes once, downloads base names, and saves its files', async ({ page }) => {
  const fixture = state();
  await enterDashboard(page);
  await page.getByRole('button', { name: 'Use Manual URL', exact: true }).click();
  await page.getByLabel('GitHub Repository URL', { exact: true }).fill('https://github.com/public/smoke-run');
  const clone = page.waitForResponse((response) => response.url() === `${fixture.serverOrigin}/api/clone-repo` && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Start AI Analysis', exact: true }).click();
  const { sessionId } = await (await clone).json();
  await expectDone(page);
  await page.getByRole('tab', { name: 'Projects', exact: true }).click();
  const view = page.getByRole('button', { name: 'View the result for public/smoke-run', exact: true });
  await expect(view).toHaveCount(1);
  await view.click();
  await expect(page).toHaveURL(`${fixture.origin}/dashboard?session=${sessionId}`);
  // Wait for the opened result to replace the retained generation form before using its controls.
  await expect(page.getByRole('heading', { name: 'Analysis Result', exact: true })).toBeVisible();
  await expect(page.locator('pre[aria-label="Dockerfile contents"]:visible')).toContainText(fixture.marker);
  const dockerDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Dockerfile', exact: true }).click();
  expect((await dockerDownload).suggestedFilename()).toBe('Dockerfile');
  await page.getByRole('tab', { name: 'ci.yml', exact: true }).click();
  const workflowDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download ci.yml', exact: true }).click();
  expect((await workflowDownload).suggestedFilename()).toBe('ci.yml');
  await page.getByRole('button', { name: 'Save to Account', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Saved Files', exact: true }).click();
  const savedDockerfile = page.getByRole('button', { name: 'Download Dockerfile from public/smoke-run', exact: true });
  await expect(savedDockerfile).toHaveCount(1);
  // Reload clears the browser's saved marker so the second save exercises database de-duplication.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Analysis Result', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save to Account', exact: true }).click();
  await expect(page.getByText('These files are already in your account', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Saved Files', exact: true }).click();
  await expect(savedDockerfile).toHaveCount(1);
});

test('3. a connected user can select and analyze a private repository', async ({ page, request }) => {
  const fixture = state();
  const connected = await request.post(`${fixture.authOrigin}/__e2e/connect-github`);
  expect(connected.status()).toBe(200);
  await enterDashboard(page);
  await page.goto(`${fixture.origin}/select-repo`);
  await expect(page.getByRole('button', { name: 'Select octo-a/private-one', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Select octo-a/private-two', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Select octo-a/private-one', exact: true }).click();
  const clone = page.waitForResponse((response) => response.url() === `${fixture.serverOrigin}/api/clone-repo` && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Start AI Analysis', exact: true }).click();
  const { sessionId } = await (await clone).json();
  await expect(page).toHaveURL(`${fixture.origin}/dashboard?session=${sessionId}`);
  await expectDone(page);
  await expect(page.locator('pre[aria-label="Dockerfile contents"]:visible')).toContainText(fixture.marker);
});

test('4. user B cannot read user A status or files', async ({ page }) => {
  const fixture = state();
  await enterDashboard(page, 'b');
  const status = page.waitForResponse((response) => response.url() === `${fixture.serverOrigin}/api/status/${fixture.sessionId}`);
  await page.goto(`${fixture.origin}/dashboard?session=${fixture.sessionId}`);
  expect((await status).status()).toBe(404);
  await expect(page.getByText('This analysis was not found or has expired', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(`${fixture.origin}/dashboard`);
  await expect(page.getByText(fixture.marker, { exact: false })).toHaveCount(0);
  await expect(page.locator('pre[aria-label="Dockerfile contents"]:visible')).toHaveCount(0);
});

test('5. signing in returns a signed-out visitor to the requested result', async ({ page }) => {
  const fixture = state();
  const target = `/dashboard?session=${fixture.sessionId}`;
  await page.goto(`${fixture.origin}${target}`);
  await expect.poll(() => new URL(page.url()).pathname).toBe('/auth');
  expect(new URL(page.url()).searchParams.get('returnTo')).toBe(target);
  await signIn(page);
  await expect(page).toHaveURL(`${fixture.origin}${target}`);
  await expect(page.locator('pre[aria-label="Dockerfile contents"]:visible')).toContainText(fixture.marker);
});

test('6. sign out reaches auth and Back cannot display the dashboard', async ({ page }) => {
  const fixture = state();
  await enterDashboard(page);
  await page.getByRole('button', { name: 'Repositories', exact: true }).click();
  await expect(page).toHaveURL(`${fixture.origin}/select-repo`);
  await page.getByRole('button', { name: 'Account menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(`${fixture.origin}/auth`);
  await page.goBack();
  await expect.poll(() => new URL(page.url()).pathname).toBe('/auth');
  await expect(page.getByRole('heading', { name: /Welcome back,/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Account menu', exact: true })).toHaveCount(0);
});
