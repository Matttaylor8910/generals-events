import {Component, Input, OnInit} from '@angular/core';
import {ModalController} from '@ionic/angular';
import {cloneDeep} from 'lodash';
import {
  applyLateOpponentToWinnersBye,
  getLateByeOpponentEligibility,
} from 'src/app/components/bracket-event/bracket-late-opponent';
import {EventService} from 'src/app/services/event.service';
import {UtilService} from 'src/app/services/util.service';
import firebase from 'firebase';
import {
  EventFormat,
  EventType,
  IBracketMatch,
  IDoubleElimEvent,
  IDynamicDYPEvent,
  IEvent,
  MatchStatus,
  MatchTeamStatus,
} from 'types';

@Component({
  selector: 'app-update-match',
  templateUrl: './update-match.page.html',
  styleUrls: ['./update-match.page.scss'],
})
export class UpdateMatchPage implements OnInit {
  @Input() match: IBracketMatch;
  @Input() event: IDoubleElimEvent;
  @Input() bracketName: string;
  @Input() roundIdx: number;
  @Input() matchIdx: number;

  scores: number[] = [0];
  newMatch: IBracketMatch;
  lateOpponentName = '';

  constructor(
      private readonly eventService: EventService,
      private readonly modalController: ModalController,
      private readonly utilService: UtilService,
  ) {}

  ngOnInit() {
    this.newMatch = cloneDeep(this.match);
    const winningSets = this.getWinningSetsForCurrentContext();
    const maxScore = Math.max(0, Number(winningSets || 0));
    this.scores = Array.from({length: maxScore + 1}, (_, i) => i);
  }

  get canSave(): boolean {
    if (!this.match?.teams.every(t => !!t.name)) {
      return false;
    }
    if (this.event.format === EventFormat.DOUBLE_ELIM &&
        this.match.teams.length < 2) {
      return false;
    }
    return true;
  }

  get showLateByeOpponent(): boolean {
    return this.event.format === EventFormat.DOUBLE_ELIM &&
        this.event.type === EventType.ONE_VS_ONE &&
        this.bracketName === 'winners' &&
        !!this.event?.bracket &&
        getLateByeOpponentEligibility(
            this.event.bracket,
            this.roundIdx,
            this.matchIdx,
            this.bracketName,
            this.match,
            !!this.event.endTime,
            ).eligible;
  }

  async addLateByeOpponent() {
    const name = this.lateOpponentName.trim();
    if (!name || !this.event?.bracket || this.event.format !== EventFormat.DOUBLE_ELIM) {
      return;
    }
    const bracket = cloneDeep(this.event.bracket);
    const result = applyLateOpponentToWinnersBye(
        bracket, this.matchIdx, name);

    if (!('ok' in result && result.ok)) {
      this.utilService.showToast(
          'error' in result ? result.error : 'Could not add opponent.');
      return;
    }

    try {
      await this.eventService.ensureLeaderboardPlayer(this.event.id, name);
      await this.eventService.commitBracketAdminBatch(
          this.event.id,
          {
            'bracket.winners': bracket.winners,
            [`bracket.results.${result.downstreamMatchNumber}`]:
                firebase.firestore.FieldValue.delete(),
            checkedInPlayers:
                firebase.firestore.FieldValue.arrayUnion(name),
          },
          [String(result.downstreamMatchNumber)],
      );
      this.utilService.showToast(
          `Added ${name} and reset winners match ${result.downstreamMatchNumber}.`);
      await this.modalController.dismiss();
    } catch (e) {
      console.error(e);
      this.utilService.showToast('Failed to update bracket.');
    }
  }

  async save() {
    // retrieve scores
    const team1Score = Number(this.newMatch.teams[0]?.score || 0);
    const team2Score = Number(this.newMatch.teams[1]?.score || 0);

    // update this match in the bracket to ready so it can advance
    // HACK: shoving this shit in to make dyp finals work
    // TODO: fix this
    if (this.event.format === EventFormat.DYNAMIC_DYP) {
      // HACK
      const event = this.event as unknown as IDynamicDYPEvent;
      const bracket = event.finals.bracket;
      const bracketLocation = 'finals.bracket';
      let winners = [];

      console.log('winning sets', bracket[this.roundIdx].winningSets);

      // match done
      if (team1Score == bracket[this.roundIdx].winningSets) {
        console.log('team 1!');
        this.newMatch.status = MatchStatus.COMPLETE;
        this.newMatch.teams[0].status = MatchTeamStatus.WINNER;
        this.newMatch.teams[1].status = MatchTeamStatus.ELIMINATED;
      }
      if (team2Score == bracket[this.roundIdx].winningSets) {
        console.log('team 2!');
        this.newMatch.status = MatchStatus.COMPLETE;
        this.newMatch.teams[1].status = MatchTeamStatus.WINNER;
        this.newMatch.teams[0].status = MatchTeamStatus.ELIMINATED;
      }

      if (this.newMatch.status === MatchStatus.COMPLETE) {
        // first done
        if (this.newMatch.number === 1) {
          // set status for game 2
          bracket[this.roundIdx].matches[this.matchIdx + 1].status =
              MatchStatus.READY;
          // set team for finals
          bracket[this.roundIdx + 1].matches[0].teams[0].name =
              team1Score > team2Score ? this.newMatch.teams[0].name :
                                        this.newMatch.teams[1].name;
          bracket[this.roundIdx + 1].matches[0].teams[0].placeholder = '';
        } else if (this.newMatch.number === 2) {
          // set finals status
          bracket[this.roundIdx + 1].matches[0].status = MatchStatus.READY;
          // set team for finals
          bracket[this.roundIdx + 1].matches[0].teams[1].name =
              team1Score > team2Score ? this.newMatch.teams[0].name :
                                        this.newMatch.teams[1].name;
          bracket[this.roundIdx + 1].matches[0].teams[1].placeholder = '';
        } else if (this.newMatch.number === 3) {
          // set winners
          winners = (team1Score > team2Score ? this.newMatch.teams[0].name :
                                               this.newMatch.teams[1].name)
                        .split(' and ');
        }
      }


      // save match
      bracket[this.roundIdx].matches[this.matchIdx] = this.newMatch;

      // save and dismiss
      if (winners.length) {
        this.eventService.updateEvent(this.event.id, {
          [`${bracketLocation}`]: bracket,
          winners: winners,
          endTime: Date.now(),
        } as any);
      } else {
        this.eventService.updateEvent(this.event.id, {
          [`${bracketLocation}`]: bracket,
        } as any);
      }
    } else {
      const bracket = this.event.bracket[this.bracketName];
      const match = bracket[this.roundIdx].matches[this.matchIdx] as IBracketMatch;
      match.status = MatchStatus.READY;
      match.teams[0].status = MatchTeamStatus.UNDECIDED;
      match.teams[1].status = MatchTeamStatus.UNDECIDED;
      bracket[this.roundIdx].complete = false;

      // save and dismiss
      this.eventService.updateEvent(this.event.id, {
        [`bracket.results.${this.match.number}`]: {team1Score, team2Score},
        [`bracket.${this.bracketName}`]: bracket,
      });
    }
    this.modalController.dismiss();
  }

  private getWinningSetsForCurrentContext(): number {
    // Dynamic DYP finals bracket
    if (this.event.format === EventFormat.DYNAMIC_DYP) {
      const dypEvent = this.event as unknown as IDynamicDYPEvent;
      const bracketRounds = dypEvent?.finals?.bracket;
      const round = bracketRounds?.[this.roundIdx];
      if (round?.winningSets) {
        return round.winningSets;
      }
      return 0;
    }

    // Double elimination bracket
    const rounds: any = (this.event as any)?.bracket?.[this.bracketName];
    const round = rounds?.[this.roundIdx];
    if (round?.winningSets) {
      return round.winningSets;
    }

    // Fallback to event-level settings by bracket name when available
    const ws = (this.event as any)?.winningSets;
    if (ws) {
      if (this.bracketName === 'winners' && ws.winners) return ws.winners;
      if (this.bracketName === 'losers' && ws.losers) return ws.losers;
      if (this.bracketName === 'semifinals' && ws.semifinals) return ws.semifinals;
      if (this.bracketName === 'finals' && ws.finals) return ws.finals;
    }

    return 0;
  }
}
