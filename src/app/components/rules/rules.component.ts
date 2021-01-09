import {Component, Input} from '@angular/core';
import {ITournament, TournamentStatus} from 'types';

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

  toggleShowRules() {
    this._showRules = !this._showRules;
  }
}
