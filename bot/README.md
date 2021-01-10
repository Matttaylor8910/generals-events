# generals.io-Bot

Ai for the online strategy game http://bot.generals.io/  (See dev doc for reference: http://dev.generals.io/)

The bot is running under the name **[Bot] Flobot** in 1v1 and consistantly sits on rank 2.

Another instance is playing Free For All(**[Bot] FLOBOT9000**) where it reached #1.

## How to use

You need a **config.js** file in the main directory, that looks like:

```javascript
let config = {};

config.user_id = 'myid';
config.username = '[Bot] MyBotName';
config.custom_game_id = 'MyRoomName';

config.user_idFFA = 'myFFAid';
config.usernameFFA = '[Bot] MyFFABotName';

module.exports = config;
```

Run the bot:

```
node app.js			//start in custom game lobby
node app.js -o		//one vs one lobby
node app.js -f		//free for all lobby
```
