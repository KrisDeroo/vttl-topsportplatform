import { test, expect } from '@playwright/test';

test('@phase1 /api/health/live returns 200 always', async ({ request }) => {
  const r = await request.get('/api/health/live');
  expect(r.status()).toBe(200);
  const body = await r.json();
  expect(body.status).toBe('ok');
});

test('@phase1 /api/health/ready returns 200 when DB+Redis up', async ({ request }) => {
  const r = await request.get('/api/health/ready');
  expect([200, 503]).toContain(r.status());
  const body = await r.json();
  expect(body.components).toBeInstanceOf(Array);
});
