import {Component, EventEmitter, Input, Output} from '@angular/core';
import {GeneralsService} from 'src/app/services/generals.service';
import {TeamArenaService} from 'src/app/services/team-arena.service';
import {UtilService} from 'src/app/services/util.service';
import {isTeamArena, rankArenaTeams} from 'team-arena';
import {DoublesPairingStrategy, EventStatus, IArenaEvent, IArenaTeam, ILeaderboardPlayer} from 'types';

const READY_TTL_MS = 90 * 1000;

@Component({
  selector: 'app-arena-teams',
  templateUrl: './arena-teams.component.html',
  styleUrls: ['./arena-teams.component.scss'],
})
export class ArenaTeamsComponent {
  @Input() event: IArenaEvent;
  @Input() players: ILeaderboardPlayer[];
  @Input() status: EventStatus;
  @Input() disqualified: boolean;

  @Output() playersClicked = new EventEmitter<string|string[]>();

  busy = false;
  error: string;

  constructor(
      public readonly generals: GeneralsService,
      private readonly teamArenaService: TeamArenaService,
      private readonly utilService: UtilService,
  ) {}

  get show(): boolean {
    return isTeamArena(this.event);
  }

  get bringYourPartner(): boolean {
    return this.event?.doublesPairingStrategy ===
        DoublesPairingStrategy.BRING_YOUR_PARTNER;
  }

  get teams(): IArenaTeam[] {
    return this.event?.arenaTeams || [];
  }

  // team standings only mean something once games exist; before that show
  // the teams in creation order
  get rankedTeams(): IArenaTeam[] {
    const teams = this.teams;
    if (!teams.some(team => (team.games || 0) > 0)) {
      return teams;
    }
    return rankArenaTeams(teams);
  }

  get myTeam(): IArenaTeam|undefined {
    return this.teams.find(
        team => (team.members || []).includes(this.generals.name));
  }

  get isCaptain(): boolean {
    return this.myTeam?.captain === this.generals.name;
  }

  get inEvent(): boolean {
    return !!this.players?.find(
        p => p.name === this.generals.name && !p.withdrawn);
  }

  get started(): boolean {
    return this.status !== EventStatus.UPCOMING;
  }

  get finished(): boolean {
    return this.status === EventStatus.FINISHED;
  }

  isReady(name: string): boolean {
    const ready = this.event?.arenaReady?.[name];
    return Number.isFinite(ready) && ready <= Date.now() &&
        Date.now() - ready < READY_TTL_MS;
  }

  missingSlots(team: IArenaTeam): number {
    return Math.max(0, (this.event?.teamSize || 0) -
        (team.members || []).length);
  }

  openSlots(team: IArenaTeam): any[] {
    return new Array(this.missingSlots(team));
  }

  // a team is queued when every active member is freshly ready
  teamQueued(team: IArenaTeam): boolean {
    return (team.members || []).length > 0 &&
        team.members.every(member => this.isReady(member));
  }

  // the caller's team is in a dispatched game
  get playing(): boolean {
    return !!this.event?.arenaPlaying?.includes(this.generals.name);
  }

  // roster controls are inert once the event is finished, while the team is
  // queued or playing, or while a mutation is in flight
  get controlsDisabled(): boolean {
    return this.busy || this.finished || this.playing ||
        (this.myTeam ? this.teamQueued(this.myTeam) : false);
  }

  // a team cannot be mutated while any member is in a dispatched game or
  // every member is freshly ready — the same check the service enforces
  // inside its transaction
  teamBusy(team: IArenaTeam): boolean {
    return (team.members || []).some(member =>
        (this.event?.arenaPlaying || []).includes(member)) ||
        this.teamQueued(team);
  }

  canJoin(team: IArenaTeam): boolean {
    return this.inEvent && !this.disqualified && !this.myTeam &&
        !team.requests?.includes(this.generals.name) &&
        this.missingSlots(team) > 0 && !this.teamBusy(team);
  }

  // incomplete teams that opted into taking a random fill player; busy or
  // queued teams can never accept a mutation
  get fillTeams(): IArenaTeam[] {
    return this.teams.filter(team =>
        team.acceptFill && this.missingSlots(team) > 0 &&
        !this.teamBusy(team));
  }

  // registered players not already on a team, for the captain's request row
  memberName(team: IArenaTeam, member: string): string {
    return member === team.captain ? `${member} (captain)` : member;
  }

  async run(action: () => Promise<void>, success?: string) {
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.error = null;
    try {
      await action();
      this.error = null;
      if (success) {
        this.utilService.showToast(success);
      }
    } catch (e) {
      this.error = e?.message || 'Something went wrong';
      this.utilService.showToast(this.error);
    } finally {
      this.busy = false;
    }
  }

  async createTeam() {
    const name = await this.utilService.promptForText(
        'Create a team',
        `Teams of ${this.event?.teamSize} play together for the whole ` +
            'event. What should your team be called?',
        'Team name', 'Create', 'Nevermind');
    if (name === null) {
      return;
    }
    return this.run(
        () => this.teamArenaService.createTeam(this.event.id, name),
        'Team created!');
  }

  async renameTeam(team: IArenaTeam) {
    const name = await this.utilService.promptForText(
        'Team name', 'Max 20 characters!', team.name,
        'Save Name', 'Nevermind');
    if (name === null) {
      return;
    }
    return this.run(
        () => this.teamArenaService.setTeamOptions(
            this.event.id, {name}),
        'Team renamed!');
  }

  requestTeam(team: IArenaTeam) {
    return this.run(
        () => this.teamArenaService.requestTeam(this.event.id, team.id),
        `Requested to join ${team.name}`);
  }

  acceptPlayer(team: IArenaTeam, name: string) {
    return this.run(
        () => this.teamArenaService.acceptPlayer(this.event.id, name),
        `${name} joined ${team.name}`);
  }

  toggleAcceptFill(team: IArenaTeam) {
    return this.run(() => this.teamArenaService.setTeamOptions(
        this.event.id, {acceptFill: !team.acceptFill}));
  }

  toggleShortHanded(team: IArenaTeam) {
    return this.run(() => this.teamArenaService.setTeamOptions(
        this.event.id, {allowShortHanded: !team.allowShortHanded}));
  }

  async markNoShow(team: IArenaTeam, member: string) {
    const confirmed = await this.utilService.confirm(
        'Mark no-show?',
        `Remove ${member} from ${team.name}? You can take a voluntary ` +
            'fill player or opt into playing short-handed instead.',
        'Mark no-show', 'Nevermind');
    if (!confirmed) {
      return;
    }
    return this.run(
        () => this.teamArenaService.markNoShow(this.event.id, member));
  }

  joinRandomTeam() {
    return this.run(
        () => this.teamArenaService.joinRandomTeam(this.event.id),
        'You joined a team!');
  }

  leaveTeam() {
    return this.run(
        () => this.teamArenaService.leaveTeam(this.event.id),
        'You left your team');
  }

  trackByFn(index: number) {
    return index;
  }
}
