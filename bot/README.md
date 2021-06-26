# generals.io-Bot

Ai for the online strategy game http://bot.generals.io/  (See dev doc for reference: http://dev.generals.io/)

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

Have the bot join and play in an event:
```
node app.js --event FFA-Jan-2021 --bot 0
```
Spawn 30 bots from your `config.js` file to play in an event:
```
for i in {0..29}; do node app.js --event FFA-Jan-2021 --bot $i &; done
```
Have the first bot from your `config.js` file join a lobby:
```
node app.js --lobby HxRA
```
