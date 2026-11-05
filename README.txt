CRAZY RESPONSES — ROUND WINNER + LEADERBOARD FIX

This update addresses:
- The weekly leaderboard showing no scores because the old RPC read from cr_scores, which the game never populated.
- Round results not showing the author of each answer or identifying the round winner.
- The finished screen not showing the game winner and final standings.

INSTALL IN THIS ORDER

1) SUPABASE
   - Open Supabase Dashboard > SQL Editor.
   - Create a NEW query.
   - Open supabase-results-leaderboard-fix.sql from this folder.
   - Copy the entire file into the new query and click Run once.
   - The verification query at the bottom should list cr_room_state and cr_weekly_leaderboard.

   This SQL uses CREATE OR REPLACE FUNCTION. It updates those two read functions only.
   It does not delete game tables, rooms, players, answers, or votes.

2) GITHUB
   - Replace app.js with this folder's app.js.
   - Replace styles.css with this folder's styles.css.
   - Keep index.html and config.js unchanged.

3) TEST
   - Wait for GitHub Pages to publish, then hard-refresh with Ctrl+F5.
   - Play a complete match with at least 3 players.
   - Vote in each round, check that the results screen names the round winner, and finish the game to see final standings.
   - Open the weekly leaderboard after at least one vote has been cast.

SCORING RULES USED
- A point is a vote received by a player's answer.
- The round winner is the answer with the most votes.
- If responses have the same vote count, the response that received its first vote earliest wins that round.
- The game winner is the player with the most round wins; total points break a tie.
- If nobody receives any votes in the game, the finished screen says no winner could be determined.
- The weekly leaderboard totals votes received since the start of the current Monday-to-Sunday week.

NOTES
- The weekly leaderboard is calculated directly from cr_votes and cr_responses. It no longer depends on cr_scores being populated.
- I checked JavaScript syntax, but this package has not been run against your live Supabase project or tested with a live group of players. Please test before treating it as production-ready.
