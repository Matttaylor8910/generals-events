# Generals.io Tournaments

This is a tournament webapp for running events for the game [generals.io](http://generals.io/). Tournament formats are developed as we need them. The available ones are documented below.

## Tournament Formats

### Arena
#### Supports: FFA, 1v1
Arena tournaments will play in the arena style that [lichess.org](https://lichess.org/tournament) uses where the tournament runs for a set amount of time and the player with the most points at the end wins. You accumulate points based on your performance in the tournament. Whenever your current game ends, you jump in the queue to be paired with new players to jump into a new game.

### Double Elimination
#### Supports: 1v1, 2v2 (bring your partner)
Players play in a double elimination bracket until one winner wins the grand finals. The number of games played per round are configurable for the winners backet, losers bracket, semifinals, and finals. A tournament can use the total seed points (TSP) from the main generals.io site for seeding the bracket as well as limiting participants to those that qualified this season. Most of the info is out of date, but you can [read more about season rankings here](https://www.reddit.com/r/generalsio/wiki/index#wiki_season_tournament_information).

### Dynamic DYP
#### Supports: 2v2
In this format players will be paired with a new random teammate for several rounds. You will never play with the same partner twice. After these preliminary rounds finish up, the top 8 players with the most points will form teams among themselves and play out a quick single elimination tournament to determine the top two players.

## Multi-stage events
This is a special type of event where event organizers can set up multiple stages to be played in a single event. Each stage is its own event, of any type, that gets tied to this "parent" multi-stage event. For now, we are using this to try out several custom maps in a single event to get a variety of gameplay. In the future, Dynamic DYP could probably be converted to generate a multi-stage event with the finals being a Double Elimination bracket once that format supports 2v2.
