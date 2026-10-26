import {Component, Input} from '@angular/core';
import {EventService} from 'src/app/services/event.service';
import {GeneralsService} from 'src/app/services/generals.service';
import {UtilService} from 'src/app/services/util.service';
import {getConfirmedBigTeams, isValidTeamMembers} from '../../../../teams';
import {DoublesPairingStrategy, EventStatus, EventType, IDoubleElimEvent, ILeaderboardPlayer, IMatchTeam, PartnerStatus} from 'types';

@Component({
  selector: 'app-choose-partners',
  templateUrl: './choose-partners.component.html',
  styleUrls: ['./choose-partners.component.scss'],
})
export class ChoosePartnersComponent {
  @Input() event: IDoubleElimEvent;
  @Input() players: ILeaderboardPlayer[];
  @Input() status: EventStatus;
  @Input() disqualified: boolean;

  busy = false;

  constructor(
      public readonly generals: GeneralsService,
      private readonly eventService: EventService,
      private readonly utilService: UtilService,
  ) {}

  get me(): ILeaderboardPlayer {
    return this.players?.find(player => player.name === this.generals.name);
  }

  get isBigTeam(): boolean {
    return this.event?.type === EventType.BIG_TEAM;
  }

  get teamSize(): number {
    return this.event?.teamSize || 2;
  }

  get showPartners(): boolean {
    return this.event?.doublesPairingStrategy ===
        DoublesPairingStrategy.BRING_YOUR_PARTNER &&
        !this.disqualified && this.status === EventStatus.UPCOMING &&
        this.event?.checkedInPlayers?.includes(this.generals.name);
  }

  get takingRequests(): boolean {
    if (this.isBigTeam) {
      const currentSize = this.currentTeam?.players?.length || 1;
      return currentSize < this.teamSize &&
          (!this.me?.teamMembers?.length || this.me?.teamCaptain === this.generals.name);
    }

    return this.me?.partnerStatus !== PartnerStatus.CONFIRMED;
  }

  get confirmedTeams(): IMatchTeam[] {
    if (this.isBigTeam) {
      return getConfirmedBigTeams(this.event, this.players);
    }

    const teams = [];
    const partnerMap = new Map<string, string>();

    // create the teams
    for (const player of this.players) {
      partnerMap.set(player.name, player.partner);

      // these players have chosen each other as partners
      if (partnerMap.get(player.partner) === player.name) {
        const players = [player.name, player.partner].sort();
        const placeholder = players.join(' and ');
        const name = player.teamName || placeholder;

        // in the case where there is no team name set, just join player names,
        // otherwise show the team name prominently and the real names below
        teams.push({
          name,
          players,
          placeholder: name === placeholder ? '' : placeholder,
        });
      }
    }

    return teams;
  }

  get currentTeam(): IMatchTeam|null {
    if (!this.isBigTeam || !this.me) {
      return null;
    }

    const members = (isValidTeamMembers(this.me.teamMembers) ?
        this.me.teamMembers : [this.me.name])
        .slice()
        .sort((a, b) => a.localeCompare(b));

    return {
      name: this.me.teamName || members.join(' and '),
      players: members,
      placeholder: this.me.teamName ? members.join(' and ') : '',
    };
  }

  /**
   * Show the current (incomplete) team block when the player has a roster
   * that is not yet a confirmed team, so they aren't stranded without a
   * leave control. Confirmed teams already render their own controls.
   */
  get showCurrentTeam(): boolean {
    if (!this.isBigTeam || !isValidTeamMembers(this.me?.teamMembers)) {
      return false;
    }

    const mine = JSON.stringify(
        this.me.teamMembers.slice().sort((a, b) => a.localeCompare(b)));
    return !this.confirmedTeams.some(team => {
      return JSON.stringify(team.players) === mine;
    });
  }

  get confirmedTeamsHeader(): string {
    switch(this.confirmedTeams.length) {
      case 0:
        return 'Confirmed Teams:';
      case 1:
        return '1 Confirmed Team:';
      default:
        return `${this.confirmedTeams.length} Confirmed Teams:`;
    }
  }

  get availablePartners(): ILeaderboardPlayer[] {
    if (this.isBigTeam) {
      const myPlayers = new Set(this.currentTeam?.players || [this.generals.name]);
      return this.players
          ?.filter(player => {
            return this.event?.checkedInPlayers?.includes(player.name) &&
                !player.dq &&
                !myPlayers.has(player.name) &&
                !(player.teamMembers?.length > 0);
          })
          .sort((a, b) => {
            return a.name.localeCompare(b.name);
          });
    }

    return this.players
        ?.filter(player => {
          return this.event?.checkedInPlayers?.includes(player.name) &&
              !player.dq &&
              player.name !== this.generals.name &&
              player.partnerStatus !== PartnerStatus.CONFIRMED &&
              player.name !== this.me?.partner;
        })
        .sort((a, b) => {
          return a.name.localeCompare(b.name);
        });
  }

  get partnerRequests(): ILeaderboardPlayer[] {
    if (this.isBigTeam) {
      return [];
    }

    return this.players.filter(player => {
      return player.partner === this.generals.name &&
          player.partnerStatus === PartnerStatus.PENDING;
    });
  }

  onTeam(team: IMatchTeam): boolean {
    return team.players.includes(this.generals.name);
  }

  choosePartner(player: ILeaderboardPlayer) {
    if (this.isBigTeam) {
      this.chooseBigTeamPlayer(player);
      return;
    }

    // if this player has already sent me a partner request, accept it instead
    // of sending one their way
    if (this.partnerRequests.some(p => p.name === player.name)) {
      this.acceptPartner(player);
    }

    // otherwise, send a request for them to confirm
    else {
      this.eventService.selectPartner(
          this.event.id, this.generals.name, player.name);

      this.utilService.showToast(`Sent team request to ${player.name}!`);
    }
  }

  async chooseBigTeamPlayer(player: ILeaderboardPlayer) {
    if (this.busy) {
      return;
    }

    // only the captain can add players to a team
    if (this.me?.teamMembers?.length &&
        this.me.teamCaptain !== this.generals.name) {
      this.utilService.showToast('Only your team captain can add players');
      return;
    }

    // the event must not have started and the caller must be eligible
    if (this.status !== EventStatus.UPCOMING || this.disqualified ||
        !this.me || this.me.dq ||
        !this.event?.checkedInPlayers?.includes(this.me.name)) {
      this.utilService.showToast('You cannot change teams right now');
      return;
    }

    // the target must be checked in, eligible, and unassigned
    if (!player || player.dq ||
        !this.event.checkedInPlayers.includes(player.name) ||
        player.teamMembers?.length) {
      this.utilService.showToast(`${player?.name} cannot be added right now`);
      return;
    }

    // inviting a current teammate or re-inviting somebody is a no-op
    if (this.currentTeam?.players?.includes(player.name) ||
        this.sentBigTeamInvites.includes(player.name)) {
      return;
    }

    this.busy = true;
    try {
      // invitations need the recipient's consent — nothing is added to
      // the roster until they accept
      await this.eventService.sendBigTeamInvite(this.event.id, player.name);
      this.utilService.showToast(`Invitation sent to ${player.name}`);
    } catch (e) {
      this.utilService.showToast(
          e?.message || `Could not invite ${player.name}`);
    } finally {
      this.busy = false;
    }
  }

  // Invitations are snapshot-derived; cancelling one must allow re-inviting.
  get bigTeamInvites(): string[] {
    if (!this.isBigTeam || this.me?.teamMembers?.length) return [];
    return (this.me?.bigTeamInvites || []).filter(name => {
      const captain = this.players?.find(player => player.name === name);
      if (!captain || captain.dq || captain.withdrawn ||
          !this.event?.checkedInPlayers?.includes(name)) return false;
      const roster = captain.teamMembers;
      return !roster?.length || (isValidTeamMembers(roster) &&
          captain.teamCaptain === name && roster.includes(name) &&
          roster.length < this.teamSize);
    });
  }

  // players the caller has invited (outbound, cancelable)
  get sentBigTeamInvites(): string[] {
    if (!this.isBigTeam) return [];
    return (this.players || [])
        .filter(player =>
            (player.bigTeamInvites || []).includes(this.generals.name))
        .map(player => player.name);
  }

  async acceptBigTeamInvite(captain: string) {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.eventService.acceptBigTeamInvite(this.event.id, captain);
      this.utilService.showToast(`Joined ${captain}'s team`);
    } catch (e) {
      this.utilService.showToast(e?.message || 'Could not accept invite');
    } finally {
      this.busy = false;
    }
  }

  declineBigTeamInvite(captain: string) {
    if (this.busy) return;
    this.busy = true;
    this.eventService.declineBigTeamInvite(this.event.id, captain)
        .catch(e => this.utilService.showToast(
            e?.message || 'Could not decline invite'))
        .finally(() => this.busy = false);
  }

  cancelBigTeamInvite(target: string) {
    if (this.busy) return;
    this.busy = true;
    this.eventService.cancelBigTeamInvite(this.event.id, target)
        .catch(e => this.utilService.showToast(
            e?.message || 'Could not cancel invite'))
        .finally(() => this.busy = false);
  }

  acceptPartner(player: ILeaderboardPlayer) {
    this.eventService.confirmPartner(
        this.event.id, this.generals.name, player.name);
  }

  async setTeamName(team: IMatchTeam) {
    if (this.busy) {
      return;
    }

    let name = await this.utilService.promptForText(
        'Team name', 'What should your team name be? Max 20 characters!',
        team.name, 'Save Name', 'Nevermind');

    if (name !== null) {
      const sliced = name.slice(0, 20);
      this.busy = true;
      try {
        await this.eventService.setTeamName(this.event.id, team.players, sliced);
        this.utilService.showToast(`Team name set to ${sliced}`);
      } catch (e) {
        this.utilService.showToast(e?.message || 'Could not set team name');
      } finally {
        this.busy = false;
      }
    }
  }

  async leaveTeam() {
    if (this.busy) {
      return;
    }

    if (this.isBigTeam) {
      this.busy = true;
      try {
        await this.eventService.leaveBigTeam(this.event.id);
        this.utilService.showToast('You left your team');
      } catch (e) {
        this.utilService.showToast(e?.message || 'Could not leave team');
      } finally {
        this.busy = false;
      }
      return;
    }

    this.eventService.clearPartner(
        this.event.id, this.generals.name, this.me?.partner);
  }

  trackByFn(index: number) {
    return index;
  }
}
