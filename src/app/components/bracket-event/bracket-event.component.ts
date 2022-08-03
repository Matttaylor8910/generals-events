import {Component, EventEmitter, Input, Output, SimpleChange} from '@angular/core';
import {cloneDeep} from 'lodash';
import {Subject} from 'rxjs';
import {takeUntil} from 'rxjs/operators';
import {EventService} from 'src/app/services/event.service';
import {GeneralsService} from 'src/app/services/generals.service';
import {UtilService} from 'src/app/services/util.service';
import {EventStatus, EventType, IDoubleElimEvent, IDoubleEliminationBracket, ILeaderboardPlayer, IMatchTeam} from 'types';

import {ADMINS} from '../../../../constants';

import {getShuffledBracket} from './bracket-creator';

@Component({
  selector: 'app-bracket-event',
  templateUrl: './bracket-event.component.html',
  styleUrls: ['./bracket-event.component.scss'],
})
export class BracketEventComponent {
  private destroyed$ = new Subject<void>();

  @Input() event: IDoubleElimEvent;
  @Input() status: EventStatus;
  @Input() players: ILeaderboardPlayer[];
  @Input() selectedPlayers?: ILeaderboardPlayer[];
  @Input() disqualified: boolean;

  @Output() playersClicked = new EventEmitter<string|string[]>();

  bracket: IDoubleEliminationBracket;
  preview: IDoubleEliminationBracket;
  selectedTab = 'Registration';

  constructor(
      private readonly generals: GeneralsService,
      private readonly eventService: EventService,
      private readonly utilService: UtilService,
  ) {
    this.utilService.selectTab$
      .pipe(takeUntil(this.destroyed$))
      .subscribe(tab => {
        if (this.tabs.includes(tab)) this.selectedTab = tab;
      });
  }

  ngOnChanges(changes: SimpleChange) {
    if (this.event?.bracket) {
      this.bracket = this.event.bracket;

      if (['Bracket Preview', 'Admin', 'Registration'].includes(
              this.selectedTab)) {
        this.selectedTab = 'Bracket';

        if (!this.event.endTime) {
          this.utilService.showToast(
              'The event has started! Good luck have fun!', 5000);
        }
      }
    } else if (changes['event'] !== undefined) {
      this.generatePreviewBracket();
    }
  }

  get registrationOpen(): boolean {
    return this.event?.bracket === undefined;
  }

  get showRegistration(): boolean {
    return this.selectedTab === 'Registration' && this.registrationOpen;
  }

  get showBracket(): boolean {
    return this.selectedTab === 'Bracket';
  }

  get showBracketPreview(): boolean {
    return this.selectedTab === 'Bracket Preview';
  }

  get showRules(): boolean {
    return this.selectedTab === 'Rules';
  }

  get showStream(): boolean {
    return this.selectedTab === 'Stream';
  }

  get showAdmin(): boolean {
    return this.selectedTab === 'Admin';
  }

  get eventStarted(): boolean {
    return this.event?.bracket && this.status === EventStatus.ONGOING;
  }

  get isQualifiedEvent(): boolean {
    return this.event?.qualified?.length > 0;
  }

  get tabs(): string[] {
    const tabs = [];

    // before the event starts
    if (this.registrationOpen) {
      tabs.push('Registration');

      if (this.event?.tsp && this.players.length > 3) {
        tabs.push('Bracket Preview');
      }

      if (this.isAdmin) {
        tabs.push('Admin');
      }
    }

    // during the event
    else {
      tabs.push('Bracket');

      if (this.event?.twitchChannel) {
        tabs.push('Stream');
      }
    }

    // Always show a rules tab
    tabs.push('Rules');

    return tabs;
  }

  get isAdmin(): boolean {
    return ADMINS.includes(this.generals.name);
  }

  get showBracketButtons(): boolean {
    return this.isAdmin && !this.event?.bracket;
  }

  get finished(): boolean {
    return this.status === EventStatus.FINISHED;
  }

  getConfirmedTeams(): IMatchTeam[] {
    const teams = [];
    const partnerMap = new Map<string, string>();

    // create the teams
    for (const player of this.players) {
      partnerMap.set(player.name, player.partner);

      // these players have chosen each other as partners
      if (partnerMap.get(player.partner) === player.name) {
        const players = [player.name, player.partner].sort();

        // in the case where there is no team name set, just join player names
        teams.push({name: player.teamName || players.join(' and '), players});
      }
    }

    return teams;
  }

  createBracket() {
    try {
      let teams = [];

      // 1v1 just passes the list of checked in players
      if (this.event.type === EventType.ONE_VS_ONE) {
        this.players.forEach(player => {
          if (this.event.checkedInPlayers.includes(player.name)) {
            teams.push({name: player.name, players: [player.name]});
          }
        });
      }

      // 2v2 passes the list of confirmed teams
      // TODO: support DYP!
      else {
        teams = this.getConfirmedTeams();
      }

      this.bracket = getShuffledBracket(this.event, teams);
    } catch {
      this.utilService.showToast('Error creating bracket... are there enough players?');
    }
  }

  async checkInAll() {
    const confirm = await this.utilService.confirm(
        'Check in all?',
        'Are you really sure you wanna do that? Players should generally check themselves in.',
        'Check in all', 'Nevermind');

    if (confirm) {
      for (const player of this.players) {
        if (!this.event.qualified?.length ||
            this.event.qualified.includes(player.name)) {
          this.eventService.checkInPlayer(this.event.id, player.name);
        }
      }
    }
  }

  async openCheckIn() {
    const confirm = await this.utilService.confirm(
        'Open Check In?',
        'Are you sure you want to open the checkin to all players now?',
        'Open Check In', 'Nevermind');

    if (confirm) {
      this.eventService.updateEvent(this.event.id, {checkInTime: Date.now()});
    }
  }

  startEvent() {
    this.eventService.updateEvent(this.event.id, {
      bracket: this.bracket,
      startTime: Date.now(),
      playerCount: this.event.checkedInPlayers.length,
    });
  }

  updateAll() {
    for (const player of this.players) {
      this.eventService.addPlayer(this.event.id, player.name);
    }
  }

  async purgeNonQualified() {
    const confirm = await this.utilService.confirm(
      'Purge Non-Qualified Players',
      'Are you sure you want to remove all non-qualified players from the registration?',
      'Purge', 'Nevermind');

    if (confirm) {
      for (const player of this.players) {
        // this player isn't in the qualified list and doesn't have an event win
        if (!this.canPlayInEvent(player)) {
          // remove them from the registration
          this.eventService.removePlayer(this.event.id, player.name);
        }
      }
    }
  }

  generatePreviewBracket() {
    if (this.event?.tsp && this.players) {
      const cloned = cloneDeep(this.event);
      if (cloned.checkedInPlayers.length < 3) {
        if (this.event?.qualified?.length > 0) {
          cloned.checkedInPlayers =
              this.players.filter(this.canPlayInEvent.bind(this))
                  .map(p => p.name);
        } else {
          cloned.checkedInPlayers = this.players.map(p => p.name);
        }
      }
      const teams = [];
      this.players.forEach(player => {
        if (cloned.checkedInPlayers.includes(player.name)) {
          teams.push({name: player.name, players: [player.name]});
        }
      });

      // we need a minimum of 3 teams for the bracket to render
      if (teams.length >= 3) {
        const bracket = getShuffledBracket(cloned, teams);
        delete this.preview;
        setTimeout(() => {
          this.preview = bracket;
        }, 500);
      }
    }
  }

  private canPlayInEvent(player: ILeaderboardPlayer) {
    return this.event?.qualified?.includes(player.name) || player.stats?.eventWins > 0;
  }

  ngOnDestroy() {
    this.destroyed$.next();
  }
}
