const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { hash } = require('../mobile-auth');

test('web cookie and mobile bearer sessions share a PostgreSQL basket while another account stays isolated', async t => {
  // Check the actual browser script before exercising its API contract.
  new (require('node:vm').Script)(fs.readFileSync('public/index.html', 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1]);
  const db = new PGlite();
  await db.exec(fs.readFileSync('schema.sql', 'utf8'));
  await db.exec(fs.readFileSync('migrations/002-mobile-cart.sql', 'utf8'));
  await db.exec(fs.readFileSync('migrations/002-mobile-cart.sql', 'utf8'));
  const users = await db.query("INSERT INTO users(google_id,email,name) VALUES ('first','first@example.test','First'),('second','second@example.test','Second') RETURNING id");
  const [first, second] = users.rows.map(u => u.id);
  const mobileToken = 'a'.repeat(43), otherToken = 'b'.repeat(43), expiredToken = 'c'.repeat(43);
  await db.query('INSERT INTO mobile_sessions(token_hash,user_id) VALUES ($1,$2),($3,$4)', [hash(mobileToken), first, hash(otherToken), second]);
  await db.query("INSERT INTO mobile_sessions(token_hash,user_id,expires_at) VALUES ($1,$2,now()-interval '1 day')", [hash(expiredToken), first]);

  // Use real Express/Passport routes with in-process PostgreSQL and a memory web-session store.
  const pg = require('pg');
  const adapter = { query: (...args) => db.query(...args), connect: async () => ({
    query: (...args) => db.query(...args), release() {},
  }) };
  require.cache[require.resolve('pg')].exports = { ...pg, Pool: class { constructor() { return adapter; } } };
  const session = require('express-session');
  require('connect-pg-simple');
  require.cache[require.resolve('connect-pg-simple')].exports = () => session.MemoryStore;
  process.env.SESSION_SECRET = 'test-session-secret-only';
  process.env.GOOGLE_CLIENT_ID = 'test-client';
  process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
  process.env.BASE_URL = 'http://localhost';
  const app = require('../server');
  app.post('/_test/login', async (req, res, next) => {
    try {
      const { rows: [user] } = await db.query('SELECT * FROM users WHERE id=$1', [first]);
      req.login(user, error => error ? next(error) : res.json({ ok: true }));
    } catch (error) { next(error); }
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await db.close();
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  async function request(path, { token, cookie, body, method = 'GET' } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (cookie) headers.Cookie = cookie;
    const response = await fetch(base + path, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, headers: response.headers, data: await response.json() };
  }
  const login = await request('/_test/login', { method: 'POST' });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await request('/api/me', { cookie })).data.id, first);
  assert.equal((await request('/api/me', { token: mobileToken })).data.id, first);
  const products = (await request('/api/products')).data;
  assert.equal(products.length, 12, 'catalog columns exist on a fresh database');
  const product = products[0].id, another = products[1].id;
  const webAdd = await request('/api/cart/' + product, { cookie, method: 'POST', body: { delta: 1 } });
  assert.equal(webAdd.status, 200);
  assert.equal((await request('/api/cart', { token: mobileToken })).data[product], 1, 'web → mobile');
  await request('/api/cart/' + another, { token: mobileToken, method: 'POST', body: { delta: 1 } });
  const webCart = (await request('/api/cart', { cookie })).data;
  assert.equal(webCart[product], 1);
  assert.equal(webCart[another], 1, 'mobile → web');
  assert.deepEqual((await request('/api/cart', { token: otherToken })).data, {});
  await request('/api/cart/' + product, { token: mobileToken, method: 'POST', body: { delta: 1 } });
  assert.equal((await request('/api/cart', { cookie })).data[product], 2, 'increment starts from server quantity');
  assert.equal((await request('/api/cart/' + product, { token: mobileToken, method: 'PUT', body: { qty: '2oops' } })).status, 400);
  assert.equal((await request('/api/cart/' + product, { token: mobileToken, method: 'POST', body: { delta: 1.5 } })).status, 400);
  assert.equal((await request('/api/cart')).status, 401);
  assert.equal((await request('/api/cart', { token: expiredToken })).status, 401);
  assert.equal((await request('/api/cart/' + product, { token: mobileToken, method: 'PUT', body: { qty: 0 } })).status, 200);
  assert.equal((await request('/api/cart', { cookie })).data[product], undefined);
  await request('/api/mobile/logout', { token: mobileToken, method: 'POST' });
  assert.equal((await request('/api/cart', { token: mobileToken })).status, 401);
  assert.equal((await request('/api/cart', { cookie })).status, 200, 'mobile logout does not sign out the website');
});
