require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const { Pool } = require('pg');
const formData = require('form-data');
const Mailgun = require('mailgun.js');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 3 });
const mg = new Mailgun(formData).client({
  username: 'api', key: process.env.MAILGUN_API_KEY || 'missing',
  url: process.env.MAILGUN_URL || 'https://api.mailgun.net'
});

const app = express();
const DELIVERY_KOBO = 400000;
app.set('trust proxy', 1);
app.use(express.json());
app.use(session({
  store: new pgSession({ pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false,
  cookie: { maxAge: 30 * 864e5, secure: 'auto', sameSite: 'lax' }
}));
app.use(passport.initialize());
app.use(passport.session());

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: `${process.env.BASE_URL}/auth/google/callback`
}, async (_at, _rt, profile, done) => {
  try {
    const email = profile.emails?.[0]?.value, avatar = profile.photos?.[0]?.value;
    const { rows } = await pool.query(
      `INSERT INTO users (google_id, email, name, avatar) VALUES ($1,$2,$3,$4)
       ON CONFLICT (google_id) DO UPDATE SET email=$2, name=$3, avatar=$4 RETURNING *`,
      [profile.id, email, profile.displayName, avatar]);
    done(null, rows[0]);
  } catch (e) { done(e); }
}));
passport.serializeUser((u, d) => d(null, u.id));
passport.deserializeUser(async (id, d) => {
  try { d(null, (await pool.query('SELECT * FROM users WHERE id=$1', [id])).rows[0] || false); }
  catch (e) { d(e); }
});

const wrap = fn => (req, res) => fn(req, res).catch(e => { console.error(e); res.status(500).json({ error: 'Server error' }); });
const needAuth = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Login required' });
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const naira = k => '₦' + (k / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 });

// ---- Auth ----
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/#/?login=failed' }), (_q, res) => res.redirect('/#/'));
app.post('/auth/logout', (req, res) => req.logout(() => res.json({ ok: true })));
app.get('/api/me', (req, res) => res.json(req.user ? { id: req.user.id, name: req.user.name, email: req.user.email, avatar: req.user.avatar } : null));

// ---- Catalog ----
app.get('/api/categories', wrap(async (_q, res) => {
  res.json((await pool.query(`SELECT c.id, c.slug, c.name, COUNT(p.id)::int AS count
    FROM categories c LEFT JOIN products p ON p.category_id=c.id GROUP BY c.id ORDER BY c.name`)).rows);
}));
app.get('/api/products', wrap(async (req, res) => {
  const { category, q } = req.query;
  const { rows } = await pool.query(
    `SELECT p.id, p.name, p.description, p.price_kobo, p.old_price_kobo, p.best_seller, p.emoji, p.stock, c.slug AS category
     FROM products p JOIN categories c ON c.id=p.category_id
     WHERE ($1::text IS NULL OR c.slug=$1) AND ($2::text IS NULL OR p.name ILIKE '%'||$2||'%')
     ORDER BY p.id`, [category || null, q || null]);
  res.json(rows);
}));

// ---- Orders ----
app.post('/api/orders', needAuth, wrap(async (req, res) => {
  const { items, shipping } = req.body || {};
  const s = shipping || {};
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Cart is empty' });
  for (const f of ['name', 'phone', 'address', 'city'])
    if (!String(s[f] || '').trim()) return res.status(400).json({ error: `Missing ${f}` });

  const client = await pool.connect();
  let order, lines = [];
  try {
    await client.query('BEGIN');
    let total = 0;
    for (const it of items) {
      const qty = parseInt(it.qty, 10);
      if (!Number.isInteger(qty) || qty < 1 || qty > 20) throw Object.assign(new Error('Bad quantity'), { status: 400 });
      // Price comes from the DB, never from the browser. Row lock + stock check prevents overselling.
      const { rows: [p] } = await client.query('SELECT id,name,price_kobo,stock FROM products WHERE id=$1 FOR UPDATE', [it.id]);
      if (!p) throw Object.assign(new Error('Product not found'), { status: 400 });
      if (p.stock < qty) throw Object.assign(new Error(`Only ${p.stock} left of ${p.name}`), { status: 409 });
      await client.query('UPDATE products SET stock=stock-$1 WHERE id=$2', [qty, p.id]);
      total += p.price_kobo * qty;
      lines.push({ ...p, qty });
    }
    ({ rows: [order] } = await client.query(
      `INSERT INTO orders (user_id,total_kobo,ship_name,ship_phone,ship_address,ship_city)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.user.id, total + DELIVERY_KOBO, s.name.trim(), s.phone.trim(), s.address.trim(), s.city.trim()]));
    for (const l of lines)
      await client.query('INSERT INTO order_items (order_id,product_id,name,price_kobo,qty) VALUES ($1,$2,$3,$4,$5)',
        [order.id, l.id, l.name, l.price_kobo, l.qty]);
    // The order is placed, so empty the saved cart (same transaction: both happen or neither).
    await client.query('DELETE FROM cart_items WHERE user_id=$1', [req.user.id]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    client.release();
    if (e.status) return res.status(e.status).json({ error: e.message });
    throw e;
  }
  client.release();

  // Confirmation email: a failure here must not undo a paid-for order.
  let emailSent = false;
  try {
    const rowsHtml = lines.map(l => `<tr><td>${esc(l.name)} × ${l.qty}</td><td align="right">${naira(l.price_kobo * l.qty)}</td></tr>`).join('');
    await mg.messages.create(process.env.MAILGUN_DOMAIN, {
      from: process.env.MAIL_FROM, to: [req.user.email],
      subject: `Order #${order.id} confirmed`,
      text: `Thanks ${req.user.name}! Order #${order.id}\n` + lines.map(l => `${l.name} x${l.qty} - ${naira(l.price_kobo * l.qty)}`).join('\n') +
        `\nDelivery: ${naira(DELIVERY_KOBO)}\nTotal: ${naira(order.total_kobo)}\nShipping to: ${s.address}, ${s.city}`,
      html: `<h2>Thanks, ${esc(req.user.name)}!</h2><p>Order <b>#${order.id}</b> is confirmed.</p>
        <table width="100%" cellpadding="6">${rowsHtml}<tr><td>Delivery</td><td align="right">${naira(DELIVERY_KOBO)}</td></tr><tr><td><b>Total</b></td><td align="right"><b>${naira(order.total_kobo)}</b></td></tr></table>
        <p>Shipping to: ${esc(s.address)}, ${esc(s.city)}</p>`
    });
    emailSent = true;
    await pool.query('UPDATE orders SET email_sent=true WHERE id=$1', [order.id]);
  } catch (e) { console.error('Mailgun failed:', e.message); }

  res.status(201).json({ id: order.id, total_kobo: order.total_kobo, emailSent });
}));

app.get('/api/orders', needAuth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT o.id,o.total_kobo,o.status,o.created_at,
       json_agg(json_build_object('name',i.name,'qty',i.qty,'price_kobo',i.price_kobo)) AS items
     FROM orders o JOIN order_items i ON i.order_id=o.id WHERE o.user_id=$1 GROUP BY o.id ORDER BY o.id DESC`, [req.user.id]);
  res.json(rows);
}));

// ---- Cart (shared by website and phone app) ----
app.get('/api/cart', needAuth, wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT product_id, qty FROM cart_items WHERE user_id=$1', [req.user.id]);
  const cart = {}; rows.forEach(r => cart[r.product_id] = r.qty);
  res.json(cart);
}));
app.put('/api/cart/:id', needAuth, wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10), qty = parseInt(req.body?.qty, 10);
  if (!Number.isInteger(id) || !Number.isInteger(qty) || qty < 0 || qty > 20) return res.status(400).json({ error: 'Bad cart item' });
  if (qty === 0) await pool.query('DELETE FROM cart_items WHERE user_id=$1 AND product_id=$2', [req.user.id, id]);
  else {
    const ok = await pool.query('SELECT 1 FROM products WHERE id=$1', [id]);
    if (!ok.rowCount) return res.status(400).json({ error: 'Product not found' });
    await pool.query(`INSERT INTO cart_items (user_id, product_id, qty) VALUES ($1,$2,$3)
      ON CONFLICT (user_id, product_id) DO UPDATE SET qty=$3`, [req.user.id, id, qty]);
  }
  res.json({ ok: true });
}));
app.use(express.static('public'));
if (require.main === module) app.listen(process.env.PORT || 3000, () => console.log('Shop running on', process.env.BASE_URL || 'http://localhost:3000'));
module.exports = app;