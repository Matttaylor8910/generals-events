import {CommonModule} from '@angular/common';
import {NgModule} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {IonicModule} from '@ionic/angular';
import {TooltipModule} from 'ng2-tooltip-directive';

import {PipesModule} from '../pipes/pipes.module';

import {ActionsPopoverPageComponent} from './actions-popover/actions-popover-page.component';
import {ActionsPopoverComponent} from './actions-popover/actions-popover.component';
import {ArenaLeaderboardComponent} from './arena-leaderboard/arena-leaderboard.component';
import {ArenaQueueComponent} from './arena-queue/arena-queue.component';
import {BracketEventComponent} from './bracket-event/bracket-event.component';
import {BracketStatusComponent} from './bracket-status/bracket-status.component';
import {BracketComponent} from './bracket/bracket.component';
import {ChartWinRateComponent} from './chart-win-rate/chart-win-rate';
import {ChatComponent} from './chat/chat.component';
import {ChoosePartnersComponent} from './choose-partners/choose-partners.component';
import {CrownComponent} from './crown/crown.component';
import {DoubleEliminationBracketComponent} from './double-elimination-bracket/double-elimination-bracket.component';
import {DynamicDYPEventComponent} from './dynamic-dyp-event/dynamic-dyp-event.component';
import {DynamicDYPFinalsTeamsComponent} from './dynamic-dyp-finals-teams/dynamic-dyp-finals-teams.component';
import {DynamicDYPLeaderboardComponent} from './dynamic-dyp-leaderboard/dynamic-dyp-leaderboard.component';
import {DynamicDYPRoundsComponent} from './dynamic-dyp-rounds/dynamic-dyp-rounds.component';
import {DynamicDYPStatusComponent} from './dynamic-dyp-status/dynamic-dyp-status.component';
import { EventFilterComponent } from './event-filter/event-filter.component';
import {EventListItemComponent} from './event-list-item/event-list-item.component';
import {EventOverviewComponent} from './event-overview/event-overview.component';
import {EventPlayerSummaryComponent} from './event-player-summary/event-player-summary.component';
import {EventSummaryComponent} from './event-summary/event-summary.component';
import {EventTrophiesComponent} from './event-trophies/event-trophies.component';
import {EventTrophyPlayerComponent} from './event-trophy-player/event-trophy-player.component';
import {GameListComponent} from './game-list/game-list.component';
import {GameSummaryComponent} from './game-summary/game-summary.component';
import {LoginComponent} from './login/login.component';
import {RegistrationComponent} from './registration/registration.component';
import {RulesComponent} from './rules/rules.component';
import {TimerComponent} from './timer/timer.component';
import {TwitchComponent} from './twitch/twitch.component';

@NgModule({
  declarations: [
    ActionsPopoverComponent,
    ActionsPopoverPageComponent,
    ArenaLeaderboardComponent,
    ArenaQueueComponent,
    ChoosePartnersComponent,
    BracketComponent,
    BracketEventComponent,
    BracketStatusComponent,
    ChatComponent,
    CrownComponent,
    ChartWinRateComponent,
    DoubleEliminationBracketComponent,
    DynamicDYPEventComponent,
    DynamicDYPFinalsTeamsComponent,
    DynamicDYPLeaderboardComponent,
    DynamicDYPRoundsComponent,
    DynamicDYPStatusComponent,
    EventFilterComponent,
    EventListItemComponent,
    EventOverviewComponent,
    EventPlayerSummaryComponent,
    EventSummaryComponent,
    EventTrophiesComponent,
    EventTrophyPlayerComponent,
    GameListComponent,
    GameSummaryComponent,
    LoginComponent,
    RegistrationComponent,
    RulesComponent,
    TimerComponent,
    TwitchComponent,
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
    PipesModule,
  ],
  exports: [
    ActionsPopoverComponent,
    ActionsPopoverPageComponent,
    ArenaLeaderboardComponent,
    ArenaQueueComponent,
    BracketComponent,
    BracketEventComponent,
    ChoosePartnersComponent,
    BracketStatusComponent,
    ChatComponent,
    CrownComponent,
    ChartWinRateComponent,
    DoubleEliminationBracketComponent,
    DynamicDYPEventComponent,
    DynamicDYPFinalsTeamsComponent,
    DynamicDYPLeaderboardComponent,
    DynamicDYPRoundsComponent,
    DynamicDYPStatusComponent,
    EventFilterComponent,
    EventListItemComponent,
    EventOverviewComponent,
    EventPlayerSummaryComponent,
    EventSummaryComponent,
    EventTrophiesComponent,
    EventTrophyPlayerComponent,
    GameListComponent,
    GameSummaryComponent,
    LoginComponent,
    RegistrationComponent,
    RulesComponent,
    TimerComponent,
    TwitchComponent,
  ]
})
export class ComponentsModule {
}
