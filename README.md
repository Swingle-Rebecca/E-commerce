# Shop

Express + Postgres (Supabase or Neon) + Google sign-in + Mailgun order emails. Vanilla JS frontend.

## Setup
1. `npm install`
2. Copy `.env.example` to `.env` and fill it in.
   - **DATABASE_URL**: Supabase (Project Settings > Database > URI, use the pooler URL) or Neon (connection string).
   - **Google**: Cloud Console > APIs & Services > OAuth consent screen, then Credentials > Create OAuth client ID > Web.
     Add redirect URI `http://localhost:3000/auth/google/callback` (and your live URL's version later).
   - **Mailgun**: add and verify a sending domain; copy the API key. While on a sandbox domain,
     Mailgun only delivers to authorised recipients you add by hand.
3. `npm run db:init` creates tables and seeds 12 products in 4 categories.
4. `npm start`, open http://localhost:3000

## Deploy
Any Node host (Render, Railway, Fly). Set the same env vars, set `BASE_URL` to the live URL,
and add that URL's `/auth/google/callback` in Google Cloud Console.

## Known gaps
- No payment provider. Orders are saved as `placed` with no money collected. Add Paystack/Flutterwave before real sales.
- No admin screen. Edit products in the Supabase/Neon table editor.
