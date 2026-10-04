const { randomBytes, createHash, timingSafeEqual } = require('node:crypto');
const hash = value => createHash('sha256').update(value).digest('hex');
const challengeFor = value => createHash('sha256').update(value).digest('base64url');
const safeEqual = (a, b) => typeof a === 'string' && typeof b === 'string' &&
  Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const randomToken = () => randomBytes(32).toString('base64url');

function mobileAuth(pool) {
  return {
    async authenticate(req, res, next) {
      const authorization = req.get('authorization');
      if (!authorization) return next();
      const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization);
      if (!match) return res.status(401).json({ error: 'Invalid mobile session' });
      const { rows } = await pool.query('SELECT u.* FROM mobile_sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()', [hash(match[1])]);
      if (!rows[0]) return res.status(401).json({ error: 'Session expired. Please sign in again.' });
      req.user = rows[0];
      req.mobileTokenHash = hash(match[1]);
      next();
    },
    start(req, res, next) {
      const { challenge, nonce } = req.query;
      if (!/^[A-Za-z0-9_-]{43}$/.test(challenge || '') || !/^[A-Za-z0-9_-]{43}$/.test(nonce || ''))
        return res.status(400).json({ error: 'Invalid mobile login request' });
      req.session.mobileLogin = { challenge, nonce, startedAt: Date.now() };
      next();
    },
    async complete(req, res) {
      // keepSessionInfo preserves this context when Passport regenerates the session.
      const pending = req.session.mobileLogin;
      delete req.session.mobileLogin;
      if (!pending) return res.redirect('/#/');
      if (Date.now() - pending.startedAt > 10 * 60 * 1000)
        return res.redirect('beccashop://auth?error=expired');
      const code = randomToken();
      await pool.query('INSERT INTO mobile_login_codes (code_hash,user_id,challenge) VALUES ($1,$2,$3)', [hash(code), req.user.id, pending.challenge]);
      req.session.save(err => {
        if (err) return res.status(500).send('Could not finish sign-in. Please retry.');
        res.redirect('beccashop://auth?code=' + code + '&nonce=' + pending.nonce);
      });
    },
    async exchange(req, res) {
      const { code, verifier } = req.body || {};
      if (!/^[A-Za-z0-9_-]{43}$/.test(code || '') || !/^[A-Za-z0-9_-]{43,128}$/.test(verifier || ''))
        return res.status(400).json({ error: 'Invalid login code' });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows: [login] } = await client.query('SELECT * FROM mobile_login_codes WHERE code_hash=$1 AND expires_at>now() FOR UPDATE', [hash(code)]);
        if (!login || !safeEqual(login.challenge, challengeFor(verifier))) {
          await client.query('ROLLBACK');
          return res.status(401).json({ error: 'Login code expired or invalid. Please retry.' });
        }
        const token = randomToken();
        await client.query('DELETE FROM mobile_login_codes WHERE code_hash=$1', [hash(code)]);
        await client.query('INSERT INTO mobile_sessions (token_hash,user_id) VALUES ($1,$2)', [hash(token), login.user_id]);
        await client.query('COMMIT');
        res.set('Cache-Control', 'no-store').json({ token });
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    },
    async logout(req, res) {
      await pool.query('DELETE FROM mobile_sessions WHERE token_hash=$1', [req.mobileTokenHash]);
      res.json({ ok: true });
    }
  };
}
module.exports = { mobileAuth, hash, challengeFor, safeEqual };
