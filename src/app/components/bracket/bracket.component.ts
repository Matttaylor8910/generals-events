import {Component, Input} from '@angular/core';
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
  @Input() bracket: IBracketRound[];
  @Input() hideCompletedRounds: boolean;
  @Input() minRoundsToShow: number;

  rounds: IBracketRound[];
  start = 0;

  constructor(
      private readonly generals: GeneralsService,
      private readonly eventService: EventService,
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
    if (match.status === MatchStatus.READY) {
      this.generals.joinLobby(`match_${match.number}`, this.event.server, true);
    }
  }

  // TODO: remove this
  randomAdvance(match: IBracketMatch, $event: Event) {
    $event.stopPropagation();
    this.update(match.number);
  }
  // TODO: remove this
  randomUpdate(i: number) {
    this.update(i);

    if (i < 200) {
      setTimeout(() => {
        this.randomUpdate(i + 1);
      }, 700);
    }
  }
  // TODO: remove this
  update(i: number) {
    const updates = {};

    const random = Math.floor(Math.random() * 2);
    const winner = random === 0 ? 'team1Score' : 'team2Score';
    const loser = random === 0 ? 'team2Score' : 'team1Score';
    updates[`bracket.results.${i}.${winner}`] = 2;
    updates[`bracket.results.${i}.${loser}`] = Math.floor(Math.random() * 2);

    this.eventService.updateEvent(this.event.id, updates);
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
