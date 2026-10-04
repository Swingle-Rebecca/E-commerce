BEGIN;

-- Shared web/mobile carts and catalog columns (safe on an existing database).
ALTER TABLE products ADD COLUMN IF NOT EXISTS old_price_kobo INT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS best_seller BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS cart_items (
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty INT NOT NULL CHECK (qty BETWEEN 1 AND 20),
  PRIMARY KEY (user_id, product_id)
);
CREATE TABLE IF NOT EXISTS mobile_login_codes (
  code_hash TEXT PRIMARY KEY, user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '2 minutes'
);
CREATE TABLE IF NOT EXISTS mobile_sessions (
  token_hash TEXT PRIMARY KEY, user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '30 days'
);
CREATE INDEX IF NOT EXISTS mobile_sessions_user_id_idx ON mobile_sessions(user_id);

COMMIT;
