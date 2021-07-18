import {Component, EventEmitter, Input, Output} from '@angular/core';
import {ModalController} from '@ionic/angular';
import {flatten} from 'lodash';
import {UpdateMatchPage} from 'src/app/pages/event/update-match/update-match.page';
import {GeneralsService} from 'src/app/services/generals.service';
import {IBracketMatch, IBracketRound, IDoubleElimEvent, IGeneralsGameOptions, IMatchTeam, MatchStatus} from 'types';

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

  @Output() playersClicked = new EventEmitter<string|string[]>();

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
      const lobby = match.lobby ?? match.number;
      const options: IGeneralsGameOptions = {};

      // set the team or spectator params if you're in this match
      const teamIndex = match.teams?.findIndex(
          team => team.players?.includes(this.generals.name));

      if (teamIndex >= 0) {
        options.team = teamIndex + 1;
      } else {
        options.spectate = true;
      }

      this.generals.joinLobby(`match_${lobby}`, this.event, true, options);
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

  clickTeam(team: IMatchTeam, $event: Event) {
    $event.stopPropagation();
    this.playersClicked.emit(team.players ?? team.name);
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
              t.players = team.players;
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
