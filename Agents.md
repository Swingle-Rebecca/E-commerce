# AGENTS.md

## Project
Becca's Provision Shop: an online shop for everyday groceries and essentials (Port Harcourt, Nigeria). Customers browse by category, search, add to a basket, sign in with Google, and check out. A confirmation email is sent after each order.

## Stack
- Backend: Node.js + Express (`server.js`), wrapped as a Netlify Function (`netlify/functions/api.js`)
- Frontend: one file, `public/index.html`. Plain JavaScript, no framework, no build step, hash routes (`#/`, `#/category/<slug>`, `#/cart`, `#/checkout`, `#/orders`)
- Database: Postgres on Supabase (schema in `schema.sql`); sessions stored in Postgres too
- Auth: Google OAuth via Passport
- Email: Mailgun API (`mailgun.js`)
- Hosting: Netlify

## Commands
- `npm install`: install dependencies
- `npm run db:init`: create tables and seed data (needs `DATABASE_URL`)
- `npm start`: run locally at http://localhost:3000

## Rules (do not break these)
- Never commit `.env` or any secret. Keys live in `.env` locally and in Netlify environment variables when live.
- All money is stored in kobo (integers). ₦1,200 = 120000. Format with `naira()` on the frontend.
- Prices and stock are always read from the database on the server when an order is placed. Never trust prices sent from the browser.
- The fixed delivery fee is ₦4,000 (400000 kobo). It is defined in two places and they must match: `DELIVERY_KOBO` in `server.js` and `DELIVERY` in `public/index.html`.
- Escape all user and database text before putting it in HTML (`esc()` on the frontend, `esc()` in the email template).
- A failed confirmation email must never undo a saved order.

## Data notes
- Tables: categories, products, users, orders, order_items, plus `session` (created automatically).
- A product on discount has `old_price_kobo` set. `price_kobo` is the current selling price. `best_seller` is a boolean.
- Category slugs `best` and `deals` are special pages in the frontend, not real categories.

## Known gaps
- No payment provider yet (Paystack or Flutterwave is the likely choice for Nigeria). Orders are saved as `placed` with no money collected.
- No admin screen. Products are edited in the Supabase table editor.
- Products use emoji, not photos.
- Mailgun sandbox only emails authorised recipients until a custom domain is verified.