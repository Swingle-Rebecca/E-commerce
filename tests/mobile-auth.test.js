const test = require('node:test');
const assert = require('node:assert/strict');
const { mobileAuth, hash, challengeFor } = require('../mobile-auth');

function response() {
  return {
    statusCode: 200, status(n) { this.statusCode = n; return this; },
    headers: {}, set(k, v) { this.headers[k] = v; return this; },
    json(body) { this.body = body; return this; },
    redirect(url) { this.url = url; },
  };
}
function database() {
  const codes = new Map(), tokens = new Map(), calls = [];
  const pool = {
    codes, tokens, calls, released: 0,
    async connect() { return { query: pool.query, release: () => pool.released++ }; },
    async query(sql, params = []) {
      calls.push([sql, params]);
      if (sql.startsWith('SELECT * FROM mobile_login_codes')) {
        const row = codes.get(params[0]);
        return { rows: row && row.expiresAt > Date.now() ? [row] : [] };
      }
      if (sql.startsWith('INSERT INTO mobile_login_codes')) {
        codes.set(params[0], { user_id: params[1], challenge: params[2], expiresAt: Date.now() + 120000 });
      }
      if (sql.startsWith('DELETE FROM mobile_login_codes')) codes.delete(params[0]);
      if (sql.startsWith('INSERT INTO mobile_sessions')) tokens.set(params[0], params[1]);
      if (sql.startsWith('DELETE FROM mobile_sessions')) tokens.delete(params[0]);
      if (sql.startsWith('SELECT u.*')) {
        const id = tokens.get(params[0]); return { rows: id ? [{ id, email: 'account' + id + '@example.test' }] : [] };
      }
      return { rows: [] };
    },
  };
  return pool;
}

test('mobile login hands back a one-use code; correct proof selects the same user; logout revokes the token', async () => {
  const pool = database(), auth = mobileAuth(pool);
  const verifier = 'a'.repeat(64), nonce = 'n'.repeat(43);
  const session = { save: callback => callback(null) };
  let proceeded = false;
  auth.start({ query: { challenge: challengeFor(verifier), nonce }, session }, response(), () => { proceeded = true; });
  assert.equal(proceeded, true);
  const callback = response();
  await auth.complete({ session, user: { id: 42 } }, callback);
  const url = new URL(callback.url);
  const code = url.searchParams.get('code');
  assert.equal(url.searchParams.get('nonce'), nonce);
  assert.equal(pool.codes.has(code), false, 'raw code is never stored');
  const exchange = response();
  await auth.exchange({ body: { code, verifier } }, exchange);
  assert.equal(exchange.statusCode, 200);
  assert.equal(exchange.headers['Cache-Control'], 'no-store');
  assert.equal(pool.tokens.get(hash(exchange.body.token)), 42);
  assert.equal(pool.codes.size, 0);
  const replay = response();
  await auth.exchange({ body: { code, verifier } }, replay);
  assert.equal(replay.statusCode, 401);
  const request = { get: () => 'Bearer ' + exchange.body.token };
  await auth.authenticate(request, response(), () => {});
  assert.equal(request.user.id, 42);
  await auth.logout(request, response());
  const revoked = response();
  await auth.authenticate(request, revoked, () => assert.fail('revoked token was accepted'));
  assert.equal(revoked.statusCode, 401);
  assert.equal(pool.released, 2);
});

test('wrong verifier and expired codes cannot obtain a mobile session', async () => {
  for (const expired of [false, true]) {
    const pool = database(), auth = mobileAuth(pool), code = 'c'.repeat(43);
    pool.codes.set(hash(code), { user_id: 7, challenge: challengeFor('a'.repeat(64)), expiresAt: expired ? 0 : Date.now() + 120000 });
    const res = response();
    await auth.exchange({ body: { code, verifier: expired ? 'a'.repeat(64) : 'b'.repeat(64) } }, res);
    assert.equal(res.statusCode, 401);
    assert.equal(pool.tokens.size, 0);
    assert.equal(pool.released, 1);
  }
});

test('malformed mobile login input is rejected before database access', async () => {
  const pool = database(), auth = mobileAuth(pool);
  const res = response();
  auth.start({ query: { challenge: 'bad', nonce: 'bad' }, session: {} }, res, () => assert.fail());
  assert.equal(res.statusCode, 400);
  const exchange = response();
  await auth.exchange({ body: { code: {}, verifier: [] } }, exchange);
  assert.equal(exchange.statusCode, 400);
  assert.equal(pool.calls.length, 0);
});

test('web requests pass through; invalid bearer credentials cannot fall back to a web session', async () => {
  const pool = database(), auth = mobileAuth(pool);
  let passed = false;
  await auth.authenticate({ get: () => undefined }, response(), () => { passed = true; });
  assert.equal(passed, true);
  const res = response();
  await auth.authenticate({ get: () => 'Bearer invalid', user: { id: 42 } }, res, () => assert.fail());
  assert.equal(res.statusCode, 401);
});

test('a regular web callback keeps its homepage redirect', async () => {
  const res = response();
  await mobileAuth(database()).complete({ session: {} }, res);
  assert.equal(res.url, '/#/');
});
