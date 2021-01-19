import {Component, Input} from '@angular/core';
import {ITournament, TournamentStatus, TournamentType} from 'types';

@Component({
  selector: 'app-rules',
  templateUrl: './rules.component.html',
  styleUrls: ['./rules.component.scss'],
})
export class RulesComponent {
  @Input() tournament: ITournament;
  @Input() status: TournamentStatus;

  private _showRules = false;

  constructor() {}

  get showRules() {
    return this._showRules || this.status === TournamentStatus.UPCOMING;
  }

  get hasStreaks(): boolean {
    return this.tournament && this.tournament.type !== TournamentType.FFA;
  }

  get firstPlaceBonus(): boolean {
    return this.tournament?.type === TournamentType.FFA;
  }

  toggleShowRules() {
    this._showRules = !this._showRules;
  }
}
