# Crazy Responses

A simple browser-based multiplayer fill-in-the-blank party game. Players join with a username and six-character room code, write their own answers, and vote anonymously for the funniest response.

## What is included

- Guest usernames (no password/account)
- Create a room and join by room code
- 3–10 players per room
- Five rounds per match
- Player-written answers (no answer-card deck)
- Anonymous voting; players cannot vote for themselves
- Points and a final leaderboard
- Supabase Realtime updates across browsers

## Free setup

You need a free Supabase account. The game website itself is static HTML/CSS/JavaScript and can be hosted free on GitHub Pages.

### 1. Create the database

1. Go to https://supabase.com/ and create a free project.
2. Open **SQL Editor** in your Supabase dashboard.
3. Choose **New query**.
4. Open `supabase-setup.sql`, copy all its contents, paste them into the query editor, and click **Run**.

This creates the rooms, players, submissions, and votes tables and enables Realtime.

### 2. Connect the website

1. In Supabase, open **Project Settings -> API** (or **Data API / API Keys**, depending on dashboard layout).
2. Copy the **Project URL** and the **anon/public key** (sometimes called the publishable key).
3. Open `config.js`.
4. Replace `https://YOUR-PROJECT.supabase.co` with your Project URL.
5. Replace `YOUR_SUPABASE_ANON_KEY` with the anon/public key.
6. Save the file.

Never put a `service_role` or secret key in browser code. Only use the anon/public key.

### 3. Run it on your Windows computer

The easiest way:

1. Install Visual Studio Code: https://code.visualstudio.com/
2. Open the `crazy-responses` folder in VS Code.
3. Install the free **Live Server** extension (search for it in Extensions).
4. Right-click `index.html` and choose **Open with Live Server**.
5. The game opens in your browser.

You can also use Python if already installed: open a terminal in this folder and run `python -m http.server 8000`, then visit http://localhost:8000.

### 4. Test with friends

For a quick test, everyone needs to open the same hosted website. A local `localhost` link only works on your own computer. To share it online:

1. Create a GitHub account: https://github.com/
2. Create a **public** repository named `crazy-responses`.
3. Upload `index.html`, `styles.css`, `app.js`, and `config.js` to the repository root. (You can include README too.)
4. In repository **Settings -> Pages**, choose **Deploy from a branch**, select `main` and `/ (root)`, then save.
5. Wait for GitHub Pages to publish the site. Share the resulting Pages URL with friends.

Do not upload `supabase-setup.sql` if you do not want to publish your schema notes; it is not required by the website after the database is set up.

## Important prototype limitations

This is a free starter prototype, not a hardened public game service.

- The SQL uses permissive prototype policies so anonymous guests can play without accounts. Anyone who knows the project URL and public key can potentially read or modify game data.
- The browser client is not a trusted authority. A determined user could tamper with requests or scores.
- The game currently expects every player to submit before the host advances to voting, and every player to vote before the host advances to results. If someone disconnects mid-round, the host may need to restart the room; timed auto-advance and host recovery are not implemented yet.
- Leaving a room removes that player's row. For a first test, avoid leaving during a live round.
- The prompt list is built into `app.js`; edit the `prompts` array to add your own sentences.
- Supabase and GitHub Pages free-plan limits and terms can change. Check their current pricing pages before relying on a free deployment long-term.

For a public release, the next engineering step should be server-side game actions (for example, Supabase Edge Functions or database RPCs), strict row-level security, rate limits, moderation/reporting, and reliable host/disconnect handling.
