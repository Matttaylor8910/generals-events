import {CommonModule} from '@angular/common';
import {NgModule} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {IonicModule} from '@ionic/angular';
import {TooltipModule} from 'ng2-tooltip-directive';

import {ActionsPopoverPageComponent} from './actions-popover/actions-popover-page.component';
import {ActionsPopoverComponent} from './actions-popover/actions-popover.component';
import {ChatComponent} from './chat/chat.component';
import {CrownComponent} from './crown/crown.component';
import {GameListComponent} from './game-list/game-list.component';
import {GameSummaryComponent} from './game-summary/game-summary.component';
import {LoginComponent} from './login/login.component';
import {RulesComponent} from './rules/rules.component';
import {TimerComponent} from './timer/timer.component';
import {TournamentLeaderboardComponent} from './tournament-leaderboard/tournament-leaderboard.component';
import {TournamentListItemComponent} from './tournament-list-item/tournament-list-item.component';
import {TournamentOverviewComponent} from './tournament-overview/tournament-overview.component';
import {TournamentPlayerSummaryComponent} from './tournament-player-summary/tournament-player-summary.component';
import {TournamentQueueComponent} from './tournament-queue/tournament-queue.component';
import {TournamentSummaryComponent} from './tournament-summary/tournament-summary.component';
import {TournamentTrophiesComponent} from './tournament-trophies/tournament-trophies.component';
import {TournamentTrophyPlayerComponent} from './tournament-trophy-player/tournament-trophy-player.component';

@NgModule({
  declarations: [
    ActionsPopoverComponent,
    ActionsPopoverPageComponent,
    ChatComponent,
    CrownComponent,
    GameListComponent,
    GameSummaryComponent,
    LoginComponent,
    RulesComponent,
    TimerComponent,
    TournamentLeaderboardComponent,
    TournamentListItemComponent,
    TournamentOverviewComponent,
    TournamentPlayerSummaryComponent,
    TournamentQueueComponent,
    TournamentSummaryComponent,
    TournamentTrophiesComponent,
    TournamentTrophyPlayerComponent,
  ],
  imports: [
    IonicModule,
    CommonModule,
    FormsModule,
    TooltipModule.forRoot({
      'placement': 'bottom',
      'hide-delay': 0,
      'displayTouchscreen': false,
    }),
  ],
  exports: [
    ActionsPopoverComponent,
    ActionsPopoverPageComponent,
    ChatComponent,
    CrownComponent,
    GameListComponent,
    GameSummaryComponent,
    LoginComponent,
    RulesComponent,
    TimerComponent,
    TournamentLeaderboardComponent,
    TournamentListItemComponent,
    TournamentOverviewComponent,
    TournamentPlayerSummaryComponent,
    TournamentQueueComponent,
    TournamentSummaryComponent,
    TournamentTrophiesComponent,
    TournamentTrophyPlayerComponent,
  ]
})
export class ComponentsModule {
}
