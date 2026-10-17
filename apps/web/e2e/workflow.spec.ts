import { expect, test, type Browser, type Page } from '@playwright/test';

const PASSWORD = 'nexus-demo-2026';

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
}

async function newSession(browser: Browser, email: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, email);
  return { ctx, page };
}

test('protected routes redirect anonymous users to login', async ({ page }) => {
  await page.goto('/incidents');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});

test('rejects invalid credentials with an accessible error', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('sre@acme.nexus.dev');
  await page.getByLabel('Password').fill('not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('Invalid email or password');
});

test('full incident workflow, viewer restrictions and tenant isolation', async ({ page, browser }) => {
  // 1-2. log in and open the dashboard
  await login(page, 'sre@acme.nexus.dev');
  await expect(page.getByText('System health', { exact: true })).toBeVisible();
  await expect(page.getByText('Service health', { exact: true })).toBeVisible();

  // 3. inspect a service
  await page.getByRole('link', { name: 'Services', exact: true }).first().click();
  await page.getByRole('link', { name: 'Checkout Service' }).first().click();
  await expect(page.getByRole('heading', { name: 'Checkout Service' })).toBeVisible();
  await expect(page.getByText('Error trend')).toBeVisible();

  // 4. command palette → create incident
  await page.keyboard.press('Control+k');
  const input = page.locator('#palette-input');
  await expect(input).toBeFocused();
  await input.fill('create incident');
  await expect(page.getByRole('option', { name: /Create incident/ })).toBeVisible();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Create incident' });
  await expect(dialog).toBeVisible();

  // 5. fill the form (title, service, owner) and submit
  const title = `E2E checkout latency ${Date.now()}`;
  await dialog.getByLabel('Title').fill(title);
  await dialog.getByRole('combobox', { name: /Affected services/ }).click();
  await page.getByRole('option', { name: /Checkout Service/ }).click();
  await page.keyboard.press('Escape');
  await dialog.getByRole('combobox', { name: 'Owner' }).click();
  await page.getByRole('option', { name: 'Eli Chen' }).click();
  await dialog.getByRole('button', { name: 'Create incident' }).click();
  await expect(page).toHaveURL(/\/incidents\/[0-9a-f-]{36}$/);
  const incidentId = page.url().split('/').pop()!;
  await expect(page.getByRole('heading', { name: title })).toBeVisible();

  // validated transition: acknowledge, then assign a different owner
  await page.getByRole('button', { name: 'Acknowledge' }).click();
  await expect(page.getByText('Status changed from triggered to acknowledged')).toBeVisible();
  await page.getByRole('combobox', { name: 'Owner' }).click();
  await page.getByRole('option', { name: 'Sam Reyes' }).click();
  await expect(page.getByText('Assigned owner Sam Reyes')).toBeVisible();

  // 7. comment
  await page.getByLabel('Comment').fill('Rolling back the last deploy.');
  await page.getByRole('button', { name: 'Comment', exact: true }).click();
  await expect(page.getByText('Rolling back the last deploy.')).toBeVisible();

  // 8. resolve
  await page.getByRole('button', { name: 'Resolve' }).click();
  await expect(page.getByText('Status changed from acknowledged to resolved')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reopen' })).toBeVisible();

  // 9. audit history
  await page.goto('/audit?q=incident');
  await expect(page.getByText('incident.resolved').first()).toBeVisible();
  await expect(page.getByText('incident.created').first()).toBeVisible();

  // 10. viewer is blocked (UI and API)
  const viewer = await newSession(browser, 'viewer@acme.nexus.dev');
  await viewer.page.goto('/incidents');
  await expect(viewer.page.getByRole('heading', { name: 'Incidents', exact: true })).toBeVisible();
  await expect(viewer.page.getByRole('button', { name: 'Create incident' })).toHaveCount(0);
  const denied = await viewer.page.request.post('/api/v1/incidents', {
    headers: { 'x-nexus-client': 'web' },
    data: { title: 'viewer attempt', severity: 'SEV-3', serviceIds: ['00000000-0000-0000-0000-000000000000'] },
  });
  expect(denied.status()).toBe(403);
  await viewer.page.goto('/audit');
  await expect(viewer.page.getByText('You don’t have access to audit logs')).toBeVisible();
  await viewer.ctx.close();

  // 11. cross-tenant access is denied
  const globex = await newSession(browser, 'admin@globex.nexus.dev');
  const cross = await globex.page.request.get(`/api/v1/incidents/${incidentId}`, { headers: { 'x-nexus-client': 'web' } });
  expect(cross.status()).toBe(404);
  await globex.page.goto(`/incidents/${incidentId}`);
  await expect(globex.page.getByText('Couldn’t load this')).toBeVisible();
  await globex.ctx.close();
});

test('command palette: keyboard navigation, theme toggle and escape', async ({ page }) => {
  await login(page, 'admin@acme.nexus.dev');
  await page.keyboard.press('Control+k');
  await expect(page.locator('#palette-input')).toBeFocused();
  await page.keyboard.type('traces');
  await expect(page.getByRole('option').first()).toContainText('Distributed Traces');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/traces$/);
  await page.keyboard.press('Control+k');
  await expect(page.locator('#palette-input')).toBeFocused();
  await page.keyboard.type('theme');
  await expect(page.getByRole('option').first()).toContainText('theme');
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await page.keyboard.press('Control+k');
  await expect(page.locator('#palette-input')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
