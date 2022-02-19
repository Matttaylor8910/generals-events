import {Component, EventEmitter, Input, Output, SimpleChanges} from '@angular/core';
import {EventService} from 'src/app/services/event.service';
import {GeneralsService} from 'src/app/services/generals.service';
import {UtilService} from 'src/app/services/util.service';

import {ADMINS} from '../../../../constants';
import {EventStatus, EventType, IArenaEvent, ILeaderboardPlayer} from '../../../../types';

@Component({
  selector: 'app-arena-leaderboard',
  templateUrl: './arena-leaderboard.component.html',
  styleUrls: ['./arena-leaderboard.component.scss'],
})
export class ArenaLeaderboardComponent {
  @Input() event: IArenaEvent;
  @Input() status: EventStatus;
  @Input() players: ILeaderboardPlayer[];
  @Input() selectedPlayers?: ILeaderboardPlayer[];
  @Input() disqualified: boolean;

  @Output() playersClicked = new EventEmitter<string|string[]>();

  visible: ILeaderboardPlayer[];
  offset = 0;
  size = 10;

  tracking: boolean;
  trackingTooltip = 'Automatically change pages to show my username';

  inEvent = false;
  recentlyJoined = false;

  constructor(
      public readonly generals: GeneralsService,
      private readonly eventService: EventService,
      private readonly utilService: UtilService,
  ) {
    this.toggleTracking();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes.players) {
      this.determineInEvent();
      this.setVisible();
    }
  }

  // before the event starts, show the stars for the players
  get showStars(): boolean {
    return this.status === EventStatus.UPCOMING;
  }

  get showStreaks(): boolean {
    return this.event && this.event.type !== EventType.FFA;
  }

  get showTracker(): boolean {
    return this.inEvent && this.players?.length > this.size;
  }

  get showTimer(): boolean {
    return [
      EventStatus.ONGOING,
      EventStatus.ALMOST_DONE,
    ].includes(this.status);
  }

  get showQueue(): boolean {
    return [
      EventStatus.UPCOMING,
      EventStatus.ONGOING,
      EventStatus.ALMOST_DONE,
    ].includes(this.status);
  }

  get showFinalizeButton(): boolean {
    return ADMINS.includes(this.generals.name) &&
        this.status === EventStatus.FINISHED && !this.event?.winners?.length;
  }

  get pageControlText(): string {
    const players = this.players?.length || 0;
    const first = players ? this.offset + 1 : 0;
    let last = first + this.size - 1;
    if (last > players) {
      last = players;
    }
    const range = last ? `${first}-${last}` : first
    return `${range} / ${players}`;
  }

  get canPrev(): boolean {
    return this.offset > 0;
  }

  get canNext(): boolean {
    return this.offset + this.size < this.players?.length;
  }

  get canJoin() {
    return !this.inEvent && this.status === EventStatus.UPCOMING;
  }

  get canLeave() {
    return this.inEvent && this.generals.name &&
        this.status === EventStatus.UPCOMING;
  }

  eventWins(player: ILeaderboardPlayer): string[] {
    if (player?.stats?.eventWins) {
      return new Array(player.stats.eventWins);
    }
    return [];
  }

  isSelected(name: string): boolean {
    return this.selectedPlayers?.some(p => p.name === name);
  }

  prev() {
    if (this.canPrev) {
      this.offset -= this.size;
      this.toggleTracking(false);
      this.setVisible();
    }
  }

  next() {
    if (this.canNext) {
      this.offset += this.size;
      this.toggleTracking(false);
      this.setVisible();
    }
  }

  setVisible() {
    // short circuit
    if (!this.players?.length) {
      return this.visible = [];
    }

    if (this.tracking && this.inEvent) {
      const index = this.players.findIndex(p => p.name === this.generals.name);
      const page = Math.floor(index / this.size);
      this.offset = page * this.size;
    }
    this.visible = this.players.slice(this.offset, this.offset + this.size);
  }

  async join() {
    if (this.generals.name) {
      this.eventService.addPlayer(this.event.id, this.generals.name);
    } else {
      this.generals.loginFromEvent(this.event, true);
    }
    this.setRecentlyJoined();
  }

  async leave() {
    this.eventService.removePlayer(this.event.id, this.generals.name);
    this.setRecentlyJoined();
  }

  /**
   * Don't allow players to rapidly join and withdraw, make them wait 5 seconds
   */
  setRecentlyJoined() {
    this.recentlyJoined = true;
    setTimeout(() => {
      this.recentlyJoined = false;
    }, 5000);
  }

  toggleTracking(setTo?: boolean) {
    this.tracking = setTo === undefined ? !this.tracking : setTo;
    this.setVisible();
  }

  determineInEvent() {
    this.inEvent =
        this.players && !!this.players.find(p => p.name === this.generals.name);
  }

  async finalizeTournament() {
    // remove all players from the event that played 0 games
    const absentPlayersPromises =
        this.players.filter(player => !player.stats?.totalGames).map(player => {
          return this.eventService.removePlayer(this.event.id, player.name);
        });

    // remove all players simulutaneously
    if (absentPlayersPromises.length > 0) {
      await Promise.all(absentPlayersPromises);
    }

    // prompt to delete the tournament if no one played any games
    if (!this.event.completedGameCount) {
      const shouldDelete = await this.utilService.confirm(
          'Delete event?',
          'No one showed up and played any games, delete this event?', 'Delete',
          'Cancel');
      if (shouldDelete) {
        this.eventService.deleteEvent(this.event.id);
      }
    }

    // then set the winner of this arena
    else {
      this.eventService.updateEvent(this.event.id, {
        winners: [this.players[0].name],
      });
    }
  }
}
