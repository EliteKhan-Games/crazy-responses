CRAZY RESPONSES - BUG FIX UPDATE

FILES IN THIS PACKAGE
- app.js: fixes the answer field being replaced while typing, smoother deadline-based
  countdown display, immediate vote-button locking, and automatic reconnect to the
  last room after a page reload.
- styles.css: makes the answer box larger and improves vote cards and mobile styling.
- supabase-realtime-timer-fix.sql: adds server-side deadline transitions, lists active
  public rooms for spectating, and gives disconnected rooms a reconnect grace period.

INSTALL IN THIS ORDER

1. SUPABASE
   - Open your existing Supabase project and go to SQL Editor.
   - Open supabase-realtime-timer-fix.sql from this package.
   - Copy the entire file into a new SQL query and run it once.
   - The final verification query should list these five functions:
     cr_cleanup, cr_next_round, cr_public_rooms, cr_rematch, cr_tick_room.
   - This patch uses CREATE OR REPLACE FUNCTION. It does not drop your tables or
     erase your rooms, players, or round records.

2. GITHUB
   - Replace only app.js and styles.css in your current Crazy Responses repository
     with the two files from this package.
   - Keep your existing index.html and config.js unchanged.
   - Commit the changes and let GitHub Pages publish them.

3. TEST
   - Hard-refresh the game (Ctrl+F5 on Windows).
   - Test typing continuously for more than 3 seconds.
   - Test one vote per player, the 30-second voting countdown, and the 15-second
     results countdown.
   - Test reloading the host browser and joining a public room during a match.

IMPORTANT
- The countdown is calculated from the database deadline and refreshed locally,
  instead of jumping only when the room poll runs.
- The database moves answering to voting at its deadline, voting to results at its
  deadline, and results to the next round (or finished) at its deadline.
- The game still needs live testing. These files passed a JavaScript syntax check,
  but I have not connected to your Supabase project or tested a live multiplayer match.
