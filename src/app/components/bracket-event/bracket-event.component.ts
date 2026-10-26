import {Component, EventEmitter, Input, Output, SimpleChange} from '@angular/core';
import {cloneDeep} from 'lodash';
import {Subject} from 'rxjs';
import {takeUntil} from 'rxjs/operators';
import {EventService} from 'src/app/services/event.service';
import {GeneralsService} from 'src/app/services/generals.service';
import {UtilService} from 'src/app/services/util.service';
import {EventStatus, EventType, IDoubleElimEvent, IDoubleEliminationBracket, ILeaderboardPlayer, IMatchTeam} from 'types';

import {ADMINS} from '../../../../constants';
import {getConfirmedBigTeams, isValidTeamMembers, isValidTeamSize, teamIdentity} from '../../../../teams';

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
    } else if (changes['event'] !== undefined ||
               changes['players'] !== undefined) {
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
    if (this.event?.type === EventType.BIG_TEAM) {
      return this.getConfirmedBigTeams();
    }

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

  getConfirmedBigTeams(): IMatchTeam[] {
    return getConfirmedBigTeams(this.event, this.players);
  }

  /**
   * The teams currently eligible to be placed in the bracket
   */
  private getEligibleTeams(): IMatchTeam[] {
    // 1v1 just passes the list of checked in players
    if (this.event.type === EventType.ONE_VS_ONE) {
      return this.players
          .filter(player => this.event.checkedInPlayers.includes(player.name))
          .map(player => ({name: player.name, players: [player.name]}));
    }

    // 2v2 and Big Team use confirmed teams
    // TODO: support DYP!
    return this.getConfirmedTeams();
  }

  createBracket() {
    try {
      const bracket = getShuffledBracket(this.event, this.getEligibleTeams());
      if (!bracket) {
        this.utilService.showToast('Error creating bracket... are there enough players?');
        return;
      }
      this.bracket = bracket;
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
    // UI consistency only: real authorization lives in the Firestore rules
    if (!this.isAdmin) {
      this.utilService.showToast('Only event organizers can start the event');
      return;
    }
    if (this.event?.bracket || this.event?.endTime) {
      this.utilService.showToast('The event has already started');
      return;
    }
    if (!this.bracket) {
      this.utilService.showToast('Create a bracket before starting the event');
      return;
    }

    // the team partitions actually in the generated bracket: every real
    // (non-bye, non-placeholder) first round team by canonical identity
    const bracketTeams = new Set<string>();
    let participants = 0;
    let malformed = false;
    this.bracket.winners?.[0]?.matches?.forEach(match => {
      match.teams.forEach(team => {
        if (!team.players?.length) {
          return;
        }
        if (!isValidTeamMembers(team.players)) {
          malformed = true;
          return;
        }
        bracketTeams.add(teamIdentity(team.players));
        participants += team.players.length;
      });
    });

    // the teams eligible to be in the bracket right now, with valid rosters
    const eligibleTeams = this.getEligibleTeams().filter(team => {
      if (!isValidTeamMembers(team.players)) {
        return false;
      }
      // Big Team candidates must carry a proper roster for this event
      return this.event.type !== EventType.BIG_TEAM ||
          (isValidTeamSize(this.event.teamSize) &&
           team.players.length === this.event.teamSize);
    });
    const eligibleIdentities = eligibleTeams.map(team => {
      return teamIdentity(team.players);
    });

    // a stale bracket no longer matches the current eligible team
    // partitions, even when it contains the same players on different teams
    if (malformed || !bracketTeams.size || !eligibleTeams.length ||
        bracketTeams.size !== eligibleTeams.length ||
        !eligibleIdentities.every(identity => bracketTeams.has(identity))) {
      this.utilService.showToast(
          'The bracket is stale, regenerate it before starting the event');
      return;
    }

    this.eventService.updateEvent(this.event.id, {
      bracket: this.bracket,
      startTime: Date.now(),
      playerCount: participants,
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
    if (!this.event?.tsp || !this.players) {
      delete this.preview;
      return;
    }

    const cloned = cloneDeep(this.event);
    cloned.checkedInPlayers = cloned.checkedInPlayers || [];

    // Big Team previews must use the actual check-in list: unchecked teams
    // are never eligible. Other event types keep the existing fallback that
    // previews everyone as potentially checked in.
    if (this.event.type !== EventType.BIG_TEAM &&
        cloned.checkedInPlayers.length < 3) {
      if (this.event?.qualified?.length > 0) {
        cloned.checkedInPlayers =
            this.players.filter(this.canPlayInEvent.bind(this))
                .map(p => p.name);
      } else {
        cloned.checkedInPlayers = this.players.map(p => p.name);
      }
    }

    // Big Team events preview the confirmed teams; other events preview
    // each checked in player as their own 1v1 team
    let teams: IMatchTeam[];
    if (this.event.type === EventType.BIG_TEAM) {
      teams = getConfirmedBigTeams(cloned, this.players);
    } else {
      teams = [];
      this.players.forEach(player => {
        if (cloned.checkedInPlayers.includes(player.name)) {
          teams.push({name: player.name, players: [player.name]});
        }
      });
    }

    // brackets now support a minimum of two teams; drop any stale preview
    // when fewer teams remain eligible or one cannot be generated
    const bracket = teams.length >= 2 ?
        getShuffledBracket(cloned, teams) : null;
    if (bracket) {
      this.preview = bracket;
    } else {
      delete this.preview;
    }
  }

  private canPlayInEvent(player: ILeaderboardPlayer) {
    return this.event?.qualified?.includes(player.name) || player.stats?.eventWins > 0;
  }

  ngOnDestroy() {
    this.destroyed$.next();
  }
}
