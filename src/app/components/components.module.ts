import {CommonModule} from '@angular/common';
import {NgModule} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {IonicModule} from '@ionic/angular';
import {ActionsPopoverPageComponent} from './actions-popover/actions-popover-page.component';
import {ActionsPopoverComponent} from './actions-popover/actions-popover.component';
import {GameListItemComponent} from './game-list-item/game-list-item.component';
import {RulesComponent} from './rules/rules.component';
import {TimerComponent} from './timer/timer.component';
import {TournamentLeaderboardPlayerComponent} from './tournament-leaderboard-player/tournament-leaderboard-player.component';
import {TournamentLeaderboardComponent} from './tournament-leaderboard/tournament-leaderboard.component';
import {TournamentListItemComponent} from './tournament-list-item/tournament-list-item.component';
import {TournamentOverviewComponent} from './tournament-overview/tournament-overview.component';
import {TournamentPlayerSummaryComponent} from './tournament-player-summary/tournament-player-summary.component';
import {TournamentQueueComponent} from './tournament-queue/tournament-queue.component';
import {TournamentSummaryComponent} from './tournament-summary/tournament-summary.component';
import {TournamentTrophiesComponent} from './tournament-trophies/tournament-trophies.component';

@NgModule({
  declarations: [
    ActionsPopoverComponent,
    ActionsPopoverPageComponent,
    GameListItemComponent,
    RulesComponent,
    TimerComponent,
    TournamentLeaderboardComponent,
    TournamentLeaderboardPlayerComponent,
    TournamentListItemComponent,
    TournamentOverviewComponent,
    TournamentPlayerSummaryComponent,
    TournamentQueueComponent,
    TournamentSummaryComponent,
    TournamentTrophiesComponent,
  ],
  imports: [
    IonicModule,
    CommonModule,
    FormsModule,
  ],
  exports: [
    ActionsPopoverComponent,
    ActionsPopoverPageComponent,
    GameListItemComponent,
    RulesComponent,
    TimerComponent,
    TournamentLeaderboardComponent,
    TournamentLeaderboardPlayerComponent,
    TournamentListItemComponent,
    TournamentOverviewComponent,
    TournamentPlayerSummaryComponent,
    TournamentQueueComponent,
    TournamentSummaryComponent,
    TournamentTrophiesComponent,
  ]
})
export class ComponentsModule {
}
