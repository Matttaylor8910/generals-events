import {CommonModule} from '@angular/common';
import {NgModule} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {IonicModule} from '@ionic/angular';
import {TooltipModule} from 'ng2-tooltip-directive';

import {ActionsPopoverPageComponent} from './actions-popover/actions-popover-page.component';
import {ActionsPopoverComponent} from './actions-popover/actions-popover.component';
import {ChatComponent} from './chat/chat.component';
import {CrownComponent} from './crown/crown.component';
import {EventLeaderboardComponent} from './event-leaderboard/event-leaderboard.component';
import {EventListItemComponent} from './event-list-item/event-list-item.component';
import {EventOverviewComponent} from './event-overview/event-overview.component';
import {EventPlayerSummaryComponent} from './event-player-summary/event-player-summary.component';
import {EventQueueComponent} from './event-queue/event-queue.component';
import {EventSummaryComponent} from './event-summary/event-summary.component';
import {EventTrophiesComponent} from './event-trophies/event-trophies.component';
import {EventTrophyPlayerComponent} from './event-trophy-player/event-trophy-player.component';
import {GameListComponent} from './game-list/game-list.component';
import {GameSummaryComponent} from './game-summary/game-summary.component';
import {LoginComponent} from './login/login.component';
import {RulesComponent} from './rules/rules.component';
import {TimerComponent} from './timer/timer.component';

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
    EventLeaderboardComponent,
    EventListItemComponent,
    EventOverviewComponent,
    EventPlayerSummaryComponent,
    EventQueueComponent,
    EventSummaryComponent,
    EventTrophiesComponent,
    EventTrophyPlayerComponent,
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
    EventLeaderboardComponent,
    EventListItemComponent,
    EventOverviewComponent,
    EventPlayerSummaryComponent,
    EventQueueComponent,
    EventSummaryComponent,
    EventTrophiesComponent,
    EventTrophyPlayerComponent,
  ]
})
export class ComponentsModule {
}
