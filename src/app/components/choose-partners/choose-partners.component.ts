import {Component, Input} from '@angular/core';
import {EventService} from 'src/app/services/event.service';
import {GeneralsService} from 'src/app/services/generals.service';
import {UtilService} from 'src/app/services/util.service';
import {DoublesPairingStrategy, EventStatus, IDoubleElimEvent, ILeaderboardPlayer, IMatchTeam, PartnerStatus} from 'types';

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

  constructor(
      private readonly generals: GeneralsService,
      private readonly eventService: EventService,
      private readonly utilService: UtilService,
  ) {}

  get me(): ILeaderboardPlayer {
    return this.players?.find(player => player.name === this.generals.name);
  }

  get showPartners(): boolean {
    return this.event?.doublesPairingStrategy ===
        DoublesPairingStrategy.BRING_YOUR_PARTNER &&
        !this.disqualified && this.status === EventStatus.UPCOMING &&
        this.event?.checkedInPlayers?.includes(this.generals.name);
  }

  get takingRequests(): boolean {
    return this.me?.partnerStatus !== PartnerStatus.CONFIRMED;
  }

  get confirmedTeams(): IMatchTeam[] {
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
    return this.players
        ?.filter(player => {
          return this.event?.checkedInPlayers?.includes(player.name) &&
              player.name !== this.generals.name &&
              player.partnerStatus !== PartnerStatus.CONFIRMED &&
              player.name !== this.me?.partner;
        })
        .sort((a, b) => {
          return a.name.localeCompare(b.name);
        });
  }

  get partnerRequests(): ILeaderboardPlayer[] {
    return this.players.filter(player => {
      return player.partner === this.generals.name &&
          player.partnerStatus === PartnerStatus.PENDING;
    });
  }

  onTeam(team: IMatchTeam): boolean {
    return team.players.includes(this.generals.name);
  }

  choosePartner(player: ILeaderboardPlayer) {
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

  acceptPartner(player: ILeaderboardPlayer) {
    this.eventService.confirmPartner(
        this.event.id, this.generals.name, player.name);
  }

  async setTeamName(team: IMatchTeam) {
    let name = await this.utilService.promptForText(
        'Team name', 'What should your team name be? Max 20 characters!',
        team.name, 'Save Name', 'Nevermind');

    if (name !== null) {
      const sliced = name.slice(0, 20);
      this.eventService.setTeamName(this.event.id, team.players, sliced);
      this.utilService.showToast(`Team name set to ${sliced}`);
    }
  }

  leaveTeam() {
    this.eventService.clearPartner(
        this.event.id, this.generals.name, this.me?.partner);
  }

  trackByFn(index: number) {
    return index;
  }
}
