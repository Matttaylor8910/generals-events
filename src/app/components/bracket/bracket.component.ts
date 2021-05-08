import {Component, EventEmitter, Input, Output} from '@angular/core';
import {ModalController} from '@ionic/angular';
import {UpdateMatchPage} from 'src/app/pages/event/update-match/update-match.page';
import {GeneralsService} from 'src/app/services/generals.service';
import {IBracketMatch, IBracketRound, IDoubleElimEvent, MatchStatus} from 'types';

import {ADMINS} from '../../../../constants';

@Component({
  selector: 'app-bracket',
  templateUrl: './bracket.component.html',
  styleUrls: ['./bracket.component.scss'],
})
export class BracketComponent {
  @Input() event: IDoubleElimEvent;
  @Input() bracket: IBracketRound[];
  @Input() hideCompletedRounds: boolean;
  @Input() minRoundsToShow: number;
  @Input() bracketName: string;
  @Input() disabled = false;

  @Output() playerClicked = new EventEmitter<string>();

  rounds: IBracketRound[];
  start = 0;

  constructor(
      private readonly generals: GeneralsService,
      private readonly modalController: ModalController,
  ) {}

  ngOnChanges() {
    // crawl the bracket and update values, not references, so it doesn't
    // re-render
    this.updateBracket(this.bracket);
  }

  shouldHide(index: number): boolean {
    return index < this.start;
  }

  getBestOf(sets: number): string {
    if (sets === 1) {
      return 'Winner of one game';
    } else if (sets > 1) {
      return `Best ${sets} of ${sets * 2 - 1}`;
    }
    return '';
  }

  handleClickMatch(match: IBracketMatch) {
    if (match.status !== MatchStatus.COMPLETE && !this.disabled) {
      const players = match.teams.map(team => team.name);
      const inMatch = players.includes(this.generals.name);

      if (match.final) {
        match.lobby = 'finals';
      }

      const lobby = match.lobby ?? match.number;
      this.generals.joinLobby(
          `match_${lobby}`, this.event.server, true, !inMatch);
    }
  }

  async handleClickMatchNumber(
      match: IBracketMatch,
      roundIdx: number,
      matchIdx: number,
  ) {
    if (ADMINS.includes(this.generals.name) && !this.disabled) {
      const modal = await this.modalController.create({
        component: UpdateMatchPage,
        componentProps: {
          match,
          roundIdx,
          matchIdx,
          event: this.event,
          bracketName: this.bracketName,
        },
      });
      return await modal.present();
    }
  }

  clickPlayer(name: string, $event: Event) {
    $event.stopPropagation();
    this.playerClicked.emit(name);
  }

  private updateBracket(rounds: IBracketRound[]) {
    if (this.rounds) {
      rounds.forEach((round, roundIndex) => {
        const r = this.rounds[roundIndex];
        r.complete = round.complete;
        r.name = round.name;

        round.matches.forEach((match, matchIndex) => {
          const m = r.matches[matchIndex];

          if (m === undefined) {
            r.matches.push(match);
          } else {
            m.bye = match.bye;
            m.final = match.final;
            m.noRightBorder = match.noRightBorder;
            m.number = match.number;
            m.status = match.status;

            match.teams.forEach((team, teamIndex) => {
              const t = m.teams[teamIndex];
              t.dq = team.dq;
              t.placeholder = team.placeholder;
              t.status = team.status;
              t.score = team.score;
              t.name = team.name;
            });
          }
        });
      });
    } else {
      this.rounds = rounds;
    }

    this.determineComplete();
  }

  private determineComplete() {
    // determine which rounds to show
    if (this.hideCompletedRounds) {
      const firstNonComplete = this.rounds.findIndex(round => !round.complete);
      const nonCompleteRounds = this.rounds.length - firstNonComplete;

      // all rounds are complete
      if (firstNonComplete === -1) {
        const idealStart = this.rounds.length - this.minRoundsToShow;
        if (idealStart >= 0) {
          this.start = idealStart;
        }
      } else if (nonCompleteRounds < this.minRoundsToShow) {
        this.start = this.rounds.length > this.minRoundsToShow ?
            this.rounds.length - this.minRoundsToShow :
            0;
      } else {
        this.start = firstNonComplete;
      }
    } else {
      this.start = 0;
    }
  }
}
