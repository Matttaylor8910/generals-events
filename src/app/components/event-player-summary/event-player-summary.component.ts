import {Component, EventEmitter, Input, Output} from '@angular/core';
import {AngularFirestore} from '@angular/fire/firestore';
import {ADMINS} from 'constants';
import {default as firebase} from 'firebase';
import {GeneralsService} from 'src/app/services/generals.service';
import {UtilService} from 'src/app/services/util.service';
import {EventFormat, EventStatus, IArenaEvent, IDoubleElimEvent, ILeaderboardPlayer} from 'types';

@Component({
  selector: 'app-event-player-summary',
  templateUrl: './event-player-summary.component.html',
  styleUrls: ['./event-player-summary.component.scss'],
})
export class EventPlayerSummaryComponent {
  @Input() players: ILeaderboardPlayer[];
  @Input() event: IArenaEvent;
  @Input() status: EventStatus;
  @Input() showRank: boolean;

  @Output() close = new EventEmitter<void>();

  constructor(
      public readonly generals: GeneralsService,
      private readonly utilService: UtilService,
      private readonly afs: AngularFirestore,
  ) {}

  get upcoming(): boolean {
    return this.status === EventStatus.UPCOMING;
  }

  get notFinished(): boolean {
    return this.status !== EventStatus.FINISHED;
  }

  get isArena(): boolean {
    return this.event?.format === EventFormat.ARENA;
  }

  get isAdmin(): boolean {
    return ADMINS.includes(this.generals.name);
  }

  get showDisclaimers(): boolean {
    return this.upcoming ||
        this.players?.some(player => !player?.stats?.totalGames);
  }

  get rank(): string {
    if (this.isArena) {
      const [player] = this.players ?? [];
      return player?.rank ? String(player?.rank) : '';
    }
    return '';
  }

  get teamName(): string {
    const [player] = this.players ?? [];
    return player?.teamName || this.players?.map(p => p.name).join(' and ');
  }

  get playerQualifyString(): string {
    if (this.event?.format === EventFormat.DOUBLE_ELIM) {
      const {qualified = []} = this.event as unknown as IDoubleElimEvent;

      // only show this qualified string if this event requires being qualified
      if (qualified.length > 0) {
        // qualified only applies to 1v1
        const [player] = this.players ?? [];
        const index = qualified.indexOf(player?.name);
        if (index >= 0) {
          const week = Math.floor(index / 25) + 1;
          return 'Qualified for this event ' +
              (week > 10 ? 'because of total seed points.' :
                           `week ${week} of the season.`);
        } else {
          return 'Does not qualify for this event.'
        }
      }
    }
    return '';
  }

  /**
   * Only show KDR if it differs from average kills and only after this player
   * has died at least once
   */
  get showKDR(): boolean {
    // KDR is only shown for arena
    if (!this.isArena) return false;

    // arena is only 1v1, so there will be only one selected player
    const [player] = this.players ?? [];
    const {averageKills, killDeathRatio, totalGames, totalWins} =
        player?.stats ?? {};
    return averageKills !== killDeathRatio && totalGames > totalWins;
  }

  getDurationString(prevFinished: number, started: number): string {
    if (prevFinished > started) {
      const overlap = this.utilService.getDurationString(started, prevFinished);
      return `Overlap of ${overlap}!`
    } else {
      return this.utilService.getDurationString(prevFinished, started);
    }
  }

  handleClickTeamName() {
    if (this.players?.length === 1) {
      this.goToProfile(this.players[0].name);
    }
  }

  goToProfile(name: string) {
    this.generals.goToProfile(name, this.event?.server);
  }


  // TODO: make this better
  setAFK(player: ILeaderboardPlayer) {
    this.afs.collection('events').doc(this.event?.id).update({
      afks: firebase.firestore.FieldValue.arrayUnion(player.name)
    });
  }
}
