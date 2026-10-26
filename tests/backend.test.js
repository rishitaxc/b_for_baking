const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createBakeryServer } = require('../server');
let app, origin, dataDir, csrf, orderId, orderRevision;
const adminCookies = new Map(), customerCookies = new Map();
const fixture = { requestKey: 'order-test-0000000001', name: 'Test customer <script>', phone: '9876543210', type: 'Birthday cake', date: '2030-06-12', designId: '1009', reference: '', guests: 20, portion: 125, size: '', fulfilment: 'Collection', details: 'Pink flowers, please.' };
async function call(route, options = {}, jar = adminCookies) {
  const headers = { ...(options.body ? { 'Content-Type': 'application/json', Origin: origin } : {}), Cookie: [...jar].map(([k, v]) => k + '=' + v).join('; '), ...(options.headers || {}) };
  const response = await fetch(origin + route, { ...options, headers, redirect: 'manual' });
  for (const line of response.headers.getSetCookie()) { const [pair] = line.split(';'); const at = pair.indexOf('='); jar.set(pair.slice(0, at), pair.slice(at + 1)); }
  const type = response.headers.get('content-type') || '';
  return { status: response.status, headers: response.headers, body: type.includes('application/json') ? await response.json() : await response.text() };
}
before(async () => { dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bakery-backend-test-')); app = await createBakeryServer({ dataDir }); await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); origin = 'http://127.0.0.1:' + app.server.address().port; });
after(async () => { await app.close(); if (path.resolve(dataDir).startsWith(path.resolve(os.tmpdir()) + path.sep + 'bakery-backend-test-')) fs.rmSync(dataDir, { recursive: true, force: true }); });
test('private routes and filesystem are protected before owner setup', async () => {
  assert.equal((await call('/api/admin/orders')).status, 401);
  assert.equal((await call('/api/admin/overview')).status, 401);
  for (const file of ['/data/bakery.sqlite', '/data/visitor-secret', '/.git/config', '/server.js', '/package.json', '/README.txt', '/%2e%2e/server.js']) assert.equal((await call(file)).status, 404, file);
  const state = await call('/api/admin/session'); assert.equal(state.body.configured, false); assert.equal(state.body.setupAllowed, true);
  assert.equal((await call('/api/admin/setup', { method: 'POST', headers: { Origin: 'https://attacker.example' }, body: JSON.stringify({ username: 'owner', password: 'password-long-enough' }) })).status, 403);
});
test('owner setup, login and authenticated sessions', async () => {
  const created = await call('/api/admin/setup', { method: 'POST', body: JSON.stringify({ username: 'bakery-owner', password: 'test-password-very-long' }) });
  assert.equal(created.status, 201); csrf = created.body.csrf; assert.ok(created.headers.get('set-cookie').includes('HttpOnly')); assert.ok(created.headers.get('set-cookie').includes('SameSite=Lax'));
  assert.equal((await call('/api/admin/setup', { method: 'POST', body: JSON.stringify({ username: 'other', password: 'other-password-long' }) })).status, 409);
  assert.equal((await call('/api/admin/session')).body.authenticated, true);
  const bad = await call('/api/admin/login', { method: 'POST', body: JSON.stringify({ username: 'bakery-owner', password: 'wrong-password-long' }) }, new Map()); assert.equal(bad.status, 401);
  assert.ok(!JSON.stringify((await call('/api/admin/session')).body).includes('password_hash'));
});
test('customer order saves once, uses server-calculated weight and ignores financial impersonation', async () => {
  const result = await call('/api/orders', { method: 'POST', body: JSON.stringify({ ...fixture, status: 'Confirmed', total_paise: 10, estimated_kg: 9999 }) }, customerCookies);
  assert.equal(result.status, 201); assert.match(result.body.reference, /^BFB-/);
  const again = await call('/api/orders', { method: 'POST', body: JSON.stringify(fixture) }, customerCookies); assert.equal(again.status, 200); assert.equal(again.body.reference, result.body.reference);
  const changed = await call('/api/orders', { method: 'POST', body: JSON.stringify({ ...fixture, guests: 30 }) }, customerCookies); assert.equal(changed.status, 409);
  const list = await call('/api/admin/orders'); assert.equal(list.body.total, 1); orderId = list.body.items[0].id;
  const details = await call('/api/admin/orders/' + orderId); assert.equal(details.body.order.estimated_kg, 2.5); assert.equal(details.body.order.status, 'New enquiry'); assert.equal(details.body.order.total_paise, null); assert.equal(details.body.order.customer_name, fixture.name); assert.ok(!('request_key' in details.body.order)); orderRevision = details.body.order.revision;
  assert.equal((await call('/api/orders/' + orderId, {}, customerCookies)).status, 404);
  assert.equal((await call('/api/admin/orders/' + orderId, {}, customerCookies)).status, 401);
});
test('invalid orders are rejected without creating records', async () => {
  for (const update of [{ date: '2020-01-01' }, { date: '2030-02-31' }, { guests: -1 }, { portion: 50 }, { designId: '../../server.js' }, { reference: 'javascript:alert(1)' }, { name: '' }]) {
    const result = await call('/api/orders', { method: 'POST', body: JSON.stringify({ ...fixture, ...update, requestKey: 'invalid-request-0000001' }) }, new Map()); assert.equal(result.status, 400, JSON.stringify(update));
  }
  assert.equal((await call('/api/admin/orders')).body.total, 1);
});
test('Instagram redirects count clicks and unique browsers separately', async () => {
  for (let i = 0; i < 2; i++) assert.equal((await call('/api/metrics', { method: 'POST', body: JSON.stringify({ kind: 'page_view' }) }, customerCookies)).status, 200);
  for (let i = 0; i < 3; i++) { const click = await call('/go/instagram?source=profile&to=' + encodeURIComponent('https://www.instagram.com/b_for_baking/'), {}, customerCookies); assert.equal(click.status, 302); assert.equal(click.headers.get('location'), 'https://www.instagram.com/b_for_baking/'); }
  const other = new Map(); await call('/api/metrics', { method: 'POST', body: JSON.stringify({ kind: 'page_view' }) }, other); await call('/go/instagram?source=bot', {}, other);
  const result = (await call('/api/admin/overview?days=30')).body;
  assert.equal(result.metrics.pageViews, 3); assert.equal(result.metrics.visitors, 2); assert.equal(result.metrics.instagramClicks, 4); assert.equal(result.metrics.instagramBrowsers, 2); assert.equal(result.sources.find(s => s.source === 'profile').clicks, 3); assert.equal(result.orders.total, 1);
  await call('/api/metrics', { method: 'POST', body: JSON.stringify({ kind: 'page_view' }) }); await call('/go/instagram?source=profile');
  const withoutOwner = (await call('/api/admin/overview')).body;
  assert.equal(withoutOwner.metrics.pageViews, 3); assert.equal(withoutOwner.metrics.instagramClicks, 4);
  assert.equal((await call('/go/instagram?to=https://attacker.example')).status, 400); assert.equal((await call('/go/instagram?to=https://instagram.com.attacker.example/b_for_baking/')).status, 400);
  assert.equal((await call('/api/metrics', { method: 'POST', headers: { Origin: 'https://attacker.example' }, body: JSON.stringify({ kind: 'page_view' }) }, other)).status, 403);
});
test('status and advances require admin CSRF, valid amounts and current revision', async () => {
  const update = { revision: orderRevision, status: 'Confirmed', totalPaise: 300000, advanceRequestedPaise: 100000, advanceReceivedPaise: 0, ownerNotes: 'Test note' };
  assert.equal((await call('/api/admin/orders/' + orderId, { method: 'PATCH', body: JSON.stringify(update) })).status, 403);
  assert.equal((await call('/api/admin/orders/' + orderId, { method: 'PATCH', headers: { 'X-CSRF-Token': csrf }, body: JSON.stringify(update) })).status, 400);
  const saved = await call('/api/admin/orders/' + orderId, { method: 'PATCH', headers: { 'X-CSRF-Token': csrf }, body: JSON.stringify({ ...update, advanceReceivedPaise: 100000 }) }); assert.equal(saved.status, 200); assert.equal(saved.body.order.status, 'Confirmed');
  assert.equal((await call('/api/admin/orders/' + orderId, { method: 'PATCH', headers: { 'X-CSRF-Token': csrf }, body: JSON.stringify({ ...update, advanceReceivedPaise: 100000 }) })).status, 409);
  const details = await call('/api/admin/orders/' + orderId); assert.equal(details.body.history.length, 2); assert.match(details.body.history[0].summary, /Manually recorded/);
  assert.equal((await call('/api/admin/orders?search=Test')).body.total, 1); assert.equal((await call('/api/admin/orders?status=Completed')).body.total, 0);
});
test('custom cake configuration and private illustration persist', async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jM1sAAAAASUVORK5CYII=';
  const body = { ...fixture, requestKey: 'custom-request-0000001', designId: 'custom-build', customConfig: { shape: 'round', tiers: '2', colour: '#ffddee', accent: '#aa5577', decoration: 'flowers', flavour: 'Chocolate', message: 'Happy birthday', notes: 'A bow please' }, customImage: png };
  assert.equal((await call('/api/orders', { method: 'POST', body: JSON.stringify(body) }, customerCookies)).status, 201);
  const list = await call('/api/admin/orders'); const custom = list.body.items.find(x => x.id !== orderId); const detail = (await call('/api/admin/orders/' + custom.id)).body.order; assert.equal(detail.has_image, true); assert.equal(detail.custom_config.shape, 'round');
  assert.equal((await call('/api/admin/orders/' + custom.id + '/image', {}, customerCookies)).status, 401); const image = await call('/api/admin/orders/' + custom.id + '/image'); assert.equal(image.status, 200); assert.equal(image.headers.get('content-type'), 'image/png');
});
test('orders and analytics survive a server restart; logout invalidates the session', async () => {
  await app.close(); app = await createBakeryServer({ dataDir }); await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); origin = 'http://127.0.0.1:' + app.server.address().port;
  assert.equal((await call('/api/admin/orders')).body.total, 2); assert.equal((await call('/api/admin/overview')).body.metrics.instagramClicks, 4);
  assert.equal((await call('/api/admin/logout', { method: 'POST', headers: { 'X-CSRF-Token': csrf }, body: '{}' })).status, 200); assert.equal((await call('/api/admin/orders')).status, 401);
});
