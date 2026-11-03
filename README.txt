CRAZY RESPONSES — PLAYABLE REBUILD

WHAT'S INCLUDED
- index.html, styles.css, app.js: browser-based multiplayer game
- supabase-migration.sql: additive database migration and game RPC functions
- supabase/functions/generate-prompt/index.ts: optional AI prompt generator
- config.example.js: example only; keep your real config.js

INSTALL / UPDATE
1. Back up your Supabase project before changing its schema.
2. Keep your existing config.js in the same folder as index.html. Do not replace it with config.example.js.
3. Run the FULL supabase-migration.sql in Supabase SQL Editor. It is written for the original starter SQL schema supplied for this project. If you already ran the earlier rebuild migration, this updated migration is intended to be safe to run again.
4. Optional AI prompts: deploy supabase/functions/generate-prompt/index.ts as the generate-prompt Edge Function and set OPENAI_API_KEY as a Supabase Function secret. If the function is unavailable, the game uses a built-in prompt deck.
5. Serve the folder using a local web server or deploy it to a static host. Do not open index.html as file://.
6. Test with at least three separate browsers/devices. Each needs a distinct browser profile so it receives a different guest player ID.

PLAYABLE FLOW
- Create a public/private room, set 3/5/10 rounds and 3–10 player limit.
- At least three players are required to start.
- Each active player presses Ready. The 60-second answer timer starts only when all active players are ready.
- Each player submits one answer and may use one edit before the response deadline.
- A 30-second anonymous vote follows. Players cannot vote for themselves.
- Votes award one point each. Round winner is the answer with the most votes; ties go to the answer that received its first vote earliest.
- Results award scores atomically through a database function; round wins accumulate correctly. Results advance after 15 seconds or when the host presses Continue.
- Players joining after a round starts spectate until the next round.
- Lobby chat, public room browser, light/dark theme, sound toggle, final podium and same-room rematches are included.
- Player heartbeat allows a 90-second reconnect grace period. Stale players are then removed; host takeover goes to the highest-scoring remaining player, with earliest join as the tie-break. Empty/fully abandoned rooms are cleaned when a player opens the game or a room heartbeat runs (not by a continuously running background scheduler).
- Weekly scores reset by the Monday week_start date. The top 10 are shown on the home screen.

IMPORTANT LIMITATIONS / SECURITY
This is a playable prototype, not a hardened public launch. Your original schema uses permissive anonymous RLS policies and guest IDs stored in browser localStorage. The RPC functions make round readiness, answer edits, voting and score settlement consistent and prevent accidental duplicate score awards, but the guest UUID is still supplied by the browser and can be spoofed by a determined user. A public competitive launch needs Supabase anonymous Auth (auth.uid()), strict RLS, server-side membership validation, rate limits, room cleanup scheduling and moderation controls.

Weekly guest points follow the same browser's stored player ID. They do not automatically follow a username to another device/browser. Multiple people can share a display name and remain separate because each browser has a distinct player ID.

The AI function is optional. Without deploying it and setting OPENAI_API_KEY, prompts come from the built-in deck. Do not put an OpenAI secret or Supabase service-role key in config.js.

TROUBLESHOOTING
- “Could not find function” / RPC errors: run the updated migration, then refresh the page.
- Missing columns or tables: confirm you ran the migration against the same Supabase project configured in config.js.
- “Config needed”: make sure config.js sits beside index.html and defines window.CRAZY_RESPONSES_CONFIG with SUPABASE_URL and SUPABASE_ANON_KEY.
- If testing multiple players on one computer, use separate browser profiles or private windows; a single profile shares one guest identity.
