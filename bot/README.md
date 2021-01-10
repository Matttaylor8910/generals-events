# generals.io-Bot

Ai for the online strategy game http://bot.generals.io/  (See dev doc for reference: http://dev.generals.io/)

The bot is running under the name **[Bot] Flobot** in 1v1 and consistantly sits on rank 2.

Another instance is playing Free For All(**[Bot] FLOBOT9000**) where it reached #1.

## How to use

You need a **config.js** file in the main directory, that looks like:

```javascript
// bots that are available to be spun up
const bots = [
  {userId: 'someIdHere', name: '[BOT] googleman'},
  {userId: 'someIdHere', name: '[BOT] Lazerpent'},
  {userId: 'someIdHere', name: '[BOT] pasghetti'},
  {userId: 'someIdHere', name: '[BOT] syLph'},
];

module.exports = {
  bots: bots
};
```

Run the bot:

```
node app.js kusWBBYT0oZUEkRmLa4M 0
```

where the first param is the tournamentId and the second is the index of the bot to use
