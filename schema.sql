CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY, category_id INT NOT NULL REFERENCES categories(id),
  name TEXT NOT NULL, description TEXT DEFAULT '', price_kobo INT NOT NULL CHECK (price_kobo >= 0),
  emoji TEXT DEFAULT '🛍️', stock INT NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY, google_id TEXT UNIQUE NOT NULL, email TEXT NOT NULL,
  name TEXT, avatar TEXT, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY, user_id INT NOT NULL REFERENCES users(id),
  total_kobo INT NOT NULL, status TEXT NOT NULL DEFAULT 'placed',
  ship_name TEXT NOT NULL, ship_phone TEXT NOT NULL, ship_address TEXT NOT NULL, ship_city TEXT NOT NULL,
  email_sent BOOLEAN DEFAULT FALSE, created_at TIMESTAMPTZ DEFAULT now());
CREATE TABLE IF NOT EXISTS order_items (
  id SERIAL PRIMARY KEY, order_id INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INT REFERENCES products(id), name TEXT NOT NULL, price_kobo INT NOT NULL, qty INT NOT NULL CHECK (qty > 0));

INSERT INTO categories (slug, name) VALUES
 ('fashion','Fashion'),('electronics','Electronics'),('home','Home & Living'),('beauty','Beauty')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO products (category_id, name, description, price_kobo, emoji, stock)
SELECT c.id, v.name, v.descr, v.price, v.emoji, v.stock FROM (VALUES
 ('fashion','Classic Tee','Soft cotton crew neck.',850000,'👕',50),
 ('fashion','Canvas Sneakers','Everyday low-tops.',1800000,'👟',30),
 ('fashion','Tote Bag','Roomy, sturdy, washable.',700000,'👜',40),
 ('electronics','Wireless Earbuds','Bluetooth 5.3, 20h battery.',2500000,'🎧',25),
 ('electronics','Power Bank 20,000mAh','Dual USB, fast charge.',1950000,'🔋',35),
 ('electronics','Smart Watch','Heart-rate and sleep tracking.',3800000,'⌚',15),
 ('home','Ceramic Mug Set','Set of 4, 350ml.',1200000,'☕',60),
 ('home','Scented Candle','Soy wax, 40h burn.',900000,'🕯️',45),
 ('home','Throw Pillow','Linen cover, 45cm.',1100000,'🛋️',30),
 ('beauty','Body Butter','Shea-based, 250ml.',1000000,'🧴',50),
 ('beauty','Lip Care Trio','Three tinted balms.',650000,'💄',70),
 ('beauty','Fragrance Mist','Light daily scent, 100ml.',1500000,'🌸',40)
) AS v(cat,name,descr,price,emoji,stock) JOIN categories c ON c.slug = v.cat
WHERE NOT EXISTS (SELECT 1 FROM products);
