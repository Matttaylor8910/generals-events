/**
 * The plan is to create a website to run real-time lichess-style tournaments
 * The time constraint could be 60 to 90 minutes perhaps, the player with the
 * most point when the clock runs out wins the tournament
 *
 * Players can score points in 2 ways:
 *    1) Place well in the game to get the maximum number of points
 *    2) Capture enemy generals to get N point(s) per captured player
 *
 * If a player places in the top 3 (out of 8 players), they are considered to
 * be "on a streak". So long as a given player continues to place in the top 3
 * they get to keep their streak going. After two games of being "on a streak"
 * points earned per round are doubled.
 *
 * The landing page for this webapp will mostly be focused around the
 * leaderboard, showing which players have scored the most points. This will
 * show a player's generals.io username, current rank in this tournament, and
 * the record of points they accumulated during the tournament.
 *
 * The application will be built using Angular (and potentially Ionic as well)
 * along with Firestore as a datastore, with some serverless cloud functions
 * running any backend logic.
 *
 * When a player hits this landing page, they can join the tournament by
 * providing their generals.io username. We can quickly look up if this user
 * exists by pulling their latest game to see if they have indeed played a
 * game. If they have not, don't block them from using this username, just
 * show a warning: "This user either doesn't exist or hasn't played any games"
 * Another way to check if the user exists (even if they have played 0 games)
 * would be to request the actual profile page to see if the HTML includes the
 * "Player not found" text. One thing to keep in mind regarding usernames is
 * special characters. Make sure #HUN can play, for example.
 *
 * http://generals.io/api/validateUsername?u=%23HUN
 *
 * After the tournament has begun, show a big clock at the top left of the page
 * with the leaderboard displayed below it. Show a "Join Queue" button boldly at
 * the top right with sections for CURRENT GAMES and COMPLETED GAMES that will
 * show which players are in those games, and in the case of it being completed,
 * the rank and awarded points for the game.
 *
 * Use: http://generals.io/api/replaysForUsername?u=googleman&offset=0&count=1
 *
 * MVP PAGES:
 *  Landing page (tournaments.generals.io)
 *  Tournament page (tournaments.generals.io/{tourneyId})
 *    Join queue at (tournaments.generals.io/{tourneyId}?action=queue)
 *  Tournament list (tournaments.generals.io/past)
 *
 * FUTURE:
 *  Profile pages? (show tourneys + ranking within those tourneys)
 */

/**
 * For the generals.io side of things, pass a tournamentId to the generals site
 * when navigating to a lobby like tournament_tourneyId_gameNumber, for example:
 * http://generals.io/games/tournament_ffadec2020_1
 *
 * When a game finishes, the "Play Again" button redirects back to join the
 * tournament and automatically joins the queue again. When a player attempts to
 * join the queue, ensure that the tournament is not yet over, and if there are
 * >= the number of players needed for a round in the tournament, send those ids
 * into a game.
 */