import {Component, EventEmitter, Input, Output} from '@angular/core';
import {GeneralsService} from 'src/app/services/generals.service';

import {isTeamArena, rankArenaTeams} from '../../../../team-arena';
import {DoublesPairingStrategy, EventFormat, EventStatus, EventType, IArenaEvent, IArenaTeam, IEvent, ILeaderboardPlayer} from '../../../../types';

@Component({
  selector: 'app-event-trophies',
  templateUrl: './event-trophies.component.html',
  styleUrls: ['./event-trophies.component.scss'],
})
export class EventTrophiesComponent {
  @Input() event: IEvent;
  @Input() players: ILeaderboardPlayer[];
  @Input() status: EventStatus;

  @Output() playersClicked = new EventEmitter<string|string[]>();

  constructor(
      public readonly generals: GeneralsService,
  ) {}

  get showTrophies(): boolean {
    return this.status === EventStatus.FINISHED;
  }

  get is2v2(): boolean {
    return this.event?.type === EventType.TWO_VS_TWO;
  }

  // the adjacent-pair assumption only holds for bracketed 2v2; random
  // partner 2v2 arenas show an individual podium
  get pairAdjacent(): boolean {
    return this.is2v2 && !this.isTeamArena;
  }

  get isTeamArena(): boolean {
    return isTeamArena(this.event);
  }

  // bring-your-partner podiums come from the ranked fixed teams; the BYP
  // predicate is explicit so an arena with zero eligible teams never falls
  // back to an individual podium
  get bypArena(): boolean {
    return this.isTeamArena &&
        this.event.doublesPairingStrategy ===
            DoublesPairingStrategy.BRING_YOUR_PARTNER;
  }

  // the members a team presents on the podium: the union of its current
  // roster and historical participants (departed members and marked
  // no-shows keep what they earned), filtered to registered non-DQ docs
  // that hold a scored record for this dispatched team. Never-played fill
  // players and fresh replacements are excluded.
  private eligibleMembers(team: IArenaTeam): string[] {
    const docs = new Map(
        (this.players || []).map(player => [player.name, player]));
    const candidates = new Set(
        [...(team.members || []), ...(team.participants || [])]);
    return [...candidates].filter(name => {
      const doc = docs.get(name);
      return !!doc && !doc.dq &&
          (doc.record || []).some(record => record.teamId === team.id);
    });
  }

  // podium teams mirror the finalizer: only teams that played at least one
  // game, with no DQ'd member or historical participant, and at least one
  // eligible trophy member
  get arenaTeams(): IArenaTeam[] {
    if (!this.bypArena) {
      return [];
    }
    const docs = new Map(
        (this.players || []).map(player => [player.name, player]));
    const disqualified = (team: IArenaTeam) =>
        [...(team.members || []), ...(team.participants || [])]
            .some(name => docs.get(name)?.dq);
    const eligible = ((this.event as IArenaEvent).arenaTeams || [])
        .filter(team => (team.games || 0) > 0 && !disqualified(team))
        .filter(team => this.eligibleMembers(team).length > 0);
    return rankArenaTeams(eligible);
  }

  // a trophy entry needs a display name plus the member names for click
  // through; for individual podiums it is just the player
  private teamEntry(index: number):
      {name: string, players: string[]}|null {
    const team = this.arenaTeams[index];
    if (!team) {
      return null;
    }
    const members = this.eligibleMembers(team);
    return {
      name: `${team.name} (${members.join(', ')})`,
      players: members,
    };
  }

  // random-partner arenas show an individual podium ordered the way the
  // finalizer ranks them — points, win rate, games, name — limited to
  // actual participants who are not disqualified and played at least once
  private get arenaPlayers(): ILeaderboardPlayer[] {
    if (!this.isTeamArena || this.bypArena || !this.players) {
      return this.players;
    }
    const participants = new Set(
        (this.event as IArenaEvent).arenaParticipants || []);
    const eligible = this.players.filter(player =>
        participants.has(player.name) && !player.dq &&
        (player.record || []).length > 0);
    const order = new Map(rankArenaTeams(eligible.map(player => ({
      id: player.name,
      name: player.name,
      points: player.points || 0,
      wins: (player.record || []).filter(r => r.rank === 1).length,
      games: (player.record || []).length,
    } as any))).map((projection, index) => [projection.id, index]));
    return eligible.slice().sort(
        (a, b) => order.get(a.name) - order.get(b.name));
  }

  get first(): ILeaderboardPlayer|null {
    if (this.bypArena) {
      return this.teamEntry(0) as any;
    }
    const players = this.arenaPlayers;
    const player = players?.length > 0 ? {...players[0]} : null;
    if (player !== null && this.pairAdjacent) {
      player.name += ` and ${players[1]?.name}`;
    }
    return player;
  }

  get second(): ILeaderboardPlayer|null {
    if (this.bypArena) {
      return this.teamEntry(1) as any;
    }
    const players = this.arenaPlayers;
    const index = this.pairAdjacent ? 2 : 1;
    const player = players?.length > index ? {...players[index]} : null;
    if (player !== null && this.pairAdjacent) {
      player.name += ` and ${players[index + 1]?.name}`;
    }
    return player;
  }

  get third(): ILeaderboardPlayer|null {
    if (this.bypArena) {
      return this.teamEntry(2) as any;
    }
    const players = this.arenaPlayers;
    const index = this.pairAdjacent ? 4 : 2;
    const player = players?.length > index ? {...players[index]} : null;
    if (player !== null && this.pairAdjacent) {
      player.name += ` and ${players[index + 1]?.name}`;
    }
    return player;
  }

  get showOtherPlaces(): boolean {
    return !!this.second && !!this.third;
  }

  get isArena(): boolean {
    return this.event?.format === EventFormat.ARENA;
  }

  get dyp(): boolean {
    return this.event?.format === EventFormat.DYNAMIC_DYP;
  }

  get ongoingGameCount(): number {
    // if the event is finalized and the winners are set, return 0
    if (this.event.winners?.length > 0){
      return 0;
    }

    // for arena tourneys, we care about how many games are still ongoing
    if (this.isArena) {
      const {ongoingGameCount} = this.event as IArenaEvent;
      return ongoingGameCount;
    }

    // by default, we don't really have games we're waiting on
    return 0;
  }

  placeClicked(index: number) {
    // BYP team arenas select the earned team roster
    if (this.bypArena) {
      const entry = this.teamEntry(index);
      if (entry) {
        this.playersClicked.emit(entry.players);
      }
      return;
    }

    // for 2v2 find the team pairing
    if (this.pairAdjacent) {
      this.playersClicked.emit(
          this.players.slice(index * 2, index * 2 + 2).map(p => p.name));
    }

    // for 1v1 (and random-partner arenas) just shoot out that player's
    // name at that index in the finalize-order podium
    else {
      this.playersClicked.emit(this.arenaPlayers[index]?.name);
    }
  }
}
