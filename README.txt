Crazy Responses - leave match + 30-second voting timer fix

1. In Supabase, open SQL Editor -> New query.
2. Paste the entire contents of player-presence-and-voting-fix.sql and click Run.
   This script includes the player-presence cleanup functions and adds the shared voting timer.
   It is safe to run again if the presence fix was already installed.
3. In the ROOT of the GitHub repository, replace app.js with the app.js in this package.
4. Do not replace config.js, index.html, or styles.css.
5. Commit the change, wait for GitHub Pages to publish, then refresh the game with Ctrl+F5.

Changes:
- Adds a Leave match button during gameplay, voting, and results so players can return to the main menu.
- Adds a shared 30-second voting countdown.
- Voting automatically ends when all eligible players vote or the 30-second timer expires.
- Database checks reject votes after the deadline and votes from spectators or for one's own answer.
