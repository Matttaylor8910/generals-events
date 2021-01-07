import {Component, Input} from '@angular/core';
import {ITournament} from 'types';

@Component({
  selector: 'app-rules',
  templateUrl: './rules.component.html',
  styleUrls: ['./rules.component.scss'],
})
export class RulesComponent {
  @Input() tournament: ITournament;

  explicitlyShowRules = false;

  constructor() {}

  get showRules() {
    return this.explicitlyShowRules || this.tournament?.startTime > Date.now();
  }

  toggleShowRules() {
    this.explicitlyShowRules = !this.explicitlyShowRules;
  }
}
