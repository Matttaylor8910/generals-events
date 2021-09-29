import {Component} from '@angular/core';
import {ActivatedRoute} from '@angular/router';
import {take} from 'rxjs/operators';
import {GeneralsService} from 'src/app/services/generals.service';
import {ProfileService} from 'src/app/services/profile.service';
import {IGeneralsReplay, IPlayerProfile, IProfileStats, PlayerProfileStatus} from 'types';

@Component({
  selector: 'app-profile',
  templateUrl: './profile.page.html',
  styleUrls: ['./profile.page.scss'],
})
export class ProfilePage {
  name: string;

  profile: IPlayerProfile;
  stats: IProfileStats;

  minTurns = 50;

  constructor(
      public readonly generals: GeneralsService,
      private readonly route: ActivatedRoute,
      private readonly profileService: ProfileService,
  ) {
    this.name = this.route.snapshot.params.name;
    this.profileService.getProfile(this.name).subscribe(profile => {
      this.profile = profile;
      if (!profile.exists) {
        this.getGames();
      }
    });

    this.profileService.getReplays(this.name).subscribe(replays => {
      this.stats = this.getStats(this.name, replays);
      console.log(this.stats);
    });
  }

  get loaded() {
    return this.profile?.status === PlayerProfileStatus.LOADED;
  }

  getGames() {
    this.generals.getReplaysForUser(this.name);
  }

  getReplays() {
    this.profileService.getReplays(this.name).pipe(take(1)).subscribe(
        replays => {
          console.log(replays);
        });
  }


  private getStats(name: string, replays: IGeneralsReplay[]): IProfileStats {
    let ffaPercentileSum = 0;
    let ffaCount = 0;
    let ffaWin = 0;
    const ffaChartData = [];
    let v1Win = 0;
    let v1Count = 0;
    const v1ChartData = [];
    const previousNames = new Set<string>();

    for (const replay of replays) {
      const total = replay.ranking.length;
      if (replay.turns <= this.minTurns) {
        continue;
      }
      const rank =
          replay.ranking.findIndex(el => (el.currentName ?? el.name) === name);
      if (rank === -1) {
        continue;
      }

      const myRanking = replay.ranking[rank];
      if (myRanking.name !== name) {
        previousNames.add(myRanking.name);
      }

      if (replay.type === 'classic') {
        // ffa
        const percentile = (total - rank) / total;
        ffaPercentileSum += percentile
        if (rank === 0) ffaWin++;
        ffaCount++;
        ffaChartData.push({
          started: replay.started,
          percentile,
          rank,
          count: ffaCount,
        });
      } else if (replay.type === '1v1') {
        // 1v1
        if (rank === 0) v1Win++;
        v1Count++;
        v1ChartData.push({
          rank,
          winner: rank === 0 ? 1 : 0,
          started: replay.started,
          opponent: replay.ranking[1 - rank],
          count: v1Count,
        });
      }
    }

    return {
      ffaCount,
      ffaPercentile: ffaPercentileSum / ffaCount,
      ffaWinRate: ffaWin / ffaCount,
      ffaChartData,
      v1Count,
      v1WinRate: v1Win / v1Count,
      v1ChartData,
      previousNames: Array.from(previousNames),
    };
  }
}
