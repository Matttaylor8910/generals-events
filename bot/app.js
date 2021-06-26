const http = require('axios').default;
const io = require('socket.io-client');
const config = require('./config.js');
const Bot = require('./scripts/bot.js');

let socket = io('https://bot.generals.io');
const args = process.argv.slice(2);

const BASE_URL =
    'https://us-central1-generals-tournaments.cloudfunctions.net/api/v1';

let bot;
let playerIndex;
let replay_url = null;
let usernames;
let chatRoom;
let started = false;
let interval;

let eventId;
let lobbyId;
let botIndex = 0;
let team;
let teams;

let last;
for (const arg of args) {
  if (last === '--event') {
    eventId = arg;
  } else if (last === '--lobby') {
    lobbyId = arg;
  } else if (last === '--bot') {
    botIndex = Number(arg);
  } else if (last === '--team') {
    team = Number(arg);
  }
  last = arg;
}

if (args.length < 2) {
  help();
}

const {userId, name} = config.bots[botIndex];
const safeName = encodeURIComponent(name);
if (!userId) {
  throw `no bot for index ${botIndex}`;
}

socket.on('disconnect', function() {
  console.error('Disconnected from server.');

  // try to join event again if we disconnect
  // if the event is over, it will end the process
  loadEvent();
});

socket.on('connect', function() {
  console.log('Connected to server.');

  // if there is a lobby to join, joinCustomGameQueue();
  // else join event
  if (lobbyId) {
    joinCustomGameQueue(lobbyId);
  } else if (eventId) {
    loadEvent();
  } else {
    help();
  }
});

socket.on('game_start', function(data) {
  // Get ready to start playing the game.
  playerIndex = data.playerIndex;
  started = false;
  replay_url =
      'https://bot.generals.io/replays/' + encodeURIComponent(data.replay_id);
  usernames = data.usernames;
  teams = data.teams;
  chatRoom = data.chat_room;
  console.log(name + '\tgame starting! replay: ' + replay_url);
  socket.emit('chat_message', chatRoom, 'glhf');
  clearInterval(interval);
});

socket.on('game_update', function(data) {
  if (!started) {
    bot = new Bot(socket, playerIndex, data);
    started = true;
  }

  bot.update(data);
});

// win or lose, jump back in the queue
socket.on('game_lost', gameOver.bind(this));
socket.on('game_won', gameOver.bind(this));

function joinCustomGameQueue(lobbyId) {
  socket.emit('join_private', lobbyId, userId);

  if (team !== undefined) {
    socket.emit('set_custom_team', lobbyId, team);
  }

  interval = setInterval(() => {
    socket.emit('set_force_start', lobbyId, true);
  }, 5000);
  console.log(
      name + '\tjoining lobby: https://bot.generals.io/games/' +
      encodeURIComponent(lobbyId));
}

function gameOver() {
  socket.emit('chat_message', chatRoom, 'gg');
  socket.emit('leave_game');

  if (lobbyId) {
    joinCustomGameQueue(lobbyId);
  } else if (eventId) {
    joinEventQueue();
  }
}

function loadEvent() {
  console.log(`loading event ${eventId}`);
  http.get(`${BASE_URL}/events/${eventId}`)
      .then(response => {
        if (response.data) {
          startTime = response.data.startTime;
          endTime = response.data.endTime;

          // endTime is in the future
          if (endTime > Date.now()) {
            joinEvent();
          } else {
            eventOver();
          }
        }
      })
      .catch(error => {
        console.log(`${name}\tcouldn't load event`);
        setTimeout(loadEvent.bind(this), 5000);
      });
}

function joinEvent() {
  console.log(`${name}\tjoining event ${eventId}`);
  http.post(`${BASE_URL}/events/${eventId}/join/${safeName}`)
      .then(() => {
        joinEventQueue();
      })
      .catch(error => {
        console.log(`${name}\tcouldn't join event`);
        setTimeout(joinEvent.bind(this), 5000);
      });
}

function joinEventQueue() {
  const now = Date.now();
  if (startTime > now) {
    const difference = startTime - now;
    console.log(`event starts in ${difference / 1000} seconds`);
    setTimeout(joinEventQueue.bind(this), difference);
  } else if (endTime < now) {
    eventOver();
  } else {
    console.log(`joining queue as ${name}`);
    http.post(`${BASE_URL}/events/${eventId}/queue/${safeName}`)
        .then(() => {
          pollLobby();
        })
        .catch(error => {
          console.log(`${name}\tcouldn't join queue`);
          setTimeout(joinEventQueue.bind(this), 3000);
        });
  }
}

function pollLobby() {
  if (endTime < Date.now()) {
    return eventOver();
  }
  http.get(`${BASE_URL}/events/${eventId}/lobby/${safeName}`)
      .then(response => {
        if (response.data.lobby) {
          joinCustomGameQueue(response.data.lobby);
        } else {
          console.log(`${name}\twaiting for a lobby...`);
          setTimeout(pollLobby.bind(this), 1000);
        }
      })
      .catch(error => {
        console.log(`${name}\tget lobby failed`);
        setTimeout(pollLobby.bind(this), 1000);
      });
}

function eventOver() {
  console.log('event is over');
  process.exit();
}

function help() {
  console.log(`
    Error, please run like:\n
    node app.js --lobby [lobby_id]
    node app.js --event [event_id]
    node app.js --event [event_id] --bot [bot_index]
  `);
  process.exit();
}