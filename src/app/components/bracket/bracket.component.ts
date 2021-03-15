import {Component, Input} from '@angular/core';
import {cloneDeep} from 'lodash';
import {EventService} from 'src/app/services/event.service';
import {GeneralsService} from 'src/app/services/generals.service';
import {IBracketMatch, IBracketRound, IDoubleElimEvent, MatchStatus} from 'types';

@Component({
  selector: 'app-bracket',
  templateUrl: './bracket.component.html',
  styleUrls: ['./bracket.component.scss'],
})
export class BracketComponent {
  @Input() event: IDoubleElimEvent;
  @Input() bracketRounds: IBracketRound[];
  @Input() hideCompletedRounds: boolean;
  @Input() minRoundsToShow: number;

  rounds: IBracketRound[];

  constructor(
      private readonly generals: GeneralsService,
      private readonly eventService: EventService,
  ) {}

  ngOnChanges() {
    if (this.hideCompletedRounds) {
      const nonCompleted = this.bracketRounds.filter(round => !round.complete);

      if (this.minRoundsToShow && nonCompleted.length < this.minRoundsToShow) {
        const end = this.bracketRounds.length;
        const start = this.bracketRounds.length > this.minRoundsToShow ?
            this.bracketRounds.length - this.minRoundsToShow :
            0;
        this.rounds = this.bracketRounds.slice(start, end);
      } else {
        this.rounds = nonCompleted;
      }
    } else {
      this.rounds = cloneDeep(this.bracketRounds);
    }
  }

  handleClickMatch(match: IBracketMatch) {
    if (match.status === MatchStatus.READY) {
      this.generals.joinLobby(`match_${match.number}`, this.event.server, true);
    }
  }

  // TODO: remove this
  randomAdvance(match: IBracketMatch, $event: Event) {
    $event.stopPropagation();

    const winner = Math.floor(Math.random() * 2);
    const loser = winner === 0 ? 1 : 0;
    match.teams[winner].score = 2;
    match.teams[loser].score = Math.floor(Math.random() * 2);
    this.eventService.updateEvent(this.event.id, {bracket: this.event.bracket});
  }
}
