# Crazy Responses — fresh rebuild
1. Create a NEW Supabase project (recommended so old broken tables/functions do not collide).
2. Run `supabase-migration.sql` in Supabase SQL Editor.
3. Put your Supabase Project URL and publishable/anon key in `config.js`. Never use a service-role key in the browser.
4. Upload `index.html`, `styles.css`, `config.js`, `app.js` to the repository root.
5. GitHub Settings → Pages → Deploy from a branch → `main` → `/(root)`.
6. Hard refresh the published URL.

## Important
This is a fresh guest-mode prototype. It has room creation/joining, public browser, host settings, lobby chat, round flow, voting, rematch, and weekly leaderboard UI/API. Before a public production launch, strengthen guest identity and rate limiting. The current timer transitions occur through actions; add a trusted scheduled worker for automatic phase changes when users stop interacting. Built-in prompts are used; AI prompt generation can be added as an optional Edge Function. Test with three separate browsers before inviting others. Back up any existing Supabase project before changing its schema.
