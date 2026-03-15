const ReplaySimulationCore = require('./ReplaySimulationCore');

class EventReplaySimulation extends ReplaySimulationCore {
  constructor(replay, players, summary, currentAFK) {
    super(replay);
    this.players = players;
    this.summary = summary;
    this.currentAFK = currentAFK;
  }

  getSummaryTurn() {
    return Math.floor((this.turn + 1) / 2);
  }

  onReplayPlayerSurrender(index) {
    const turn = this.getSummaryTurn();
    const name = this.gameReplay.usernames[index];
    this.summary.push(`${name} quit on turn ${turn}`);
    this.players[index].lastTurn = turn;
    this.currentAFK.add(index);
  }

  onReplayAfkNeutralized(index) {
    const turn = this.getSummaryTurn();
    const name = this.gameReplay.usernames[index];
    this.summary.push(`No one captured ${name} before they turned into a city on turn ${turn}`);
  }

  onReplaySystemMessage(message, meta) {
    if (!meta || meta.type !== 'capture') {
      return;
    }

    const turn = this.getSummaryTurn();
    const killerIndex = meta.capturedByPlayerIndex;
    const deadIndex = meta.deadPlayerIndex;
    const killer = this.gameReplay.usernames[killerIndex];
    const dead = this.gameReplay.usernames[deadIndex];

    if (killer === undefined || dead === undefined) {
      return;
    }

    this.summary.push(`${killer} killed ${dead} on turn ${turn}`);
    this.players[killerIndex].kills++;
    this.players[killerIndex].killed.push(dead);

    if (this.players[deadIndex].lastTurn === 0) {
      this.players[deadIndex].lastTurn = turn;
      this.players[deadIndex].killedBy.push(killer);
    }
  }
}

module.exports = EventReplaySimulation;
