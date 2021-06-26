import {CommonModule} from '@angular/common';
import {NgModule} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {IonicModule} from '@ionic/angular';
import {TooltipModule} from 'ng2-tooltip-directive';
import {ComponentsModule} from 'src/app/components/components.module';

import {EventPageRoutingModule} from './event-routing.module';
import {EventPage} from './event.page';
import {UpdateMatchPage} from './update-match/update-match.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    EventPageRoutingModule,
    ComponentsModule,
    TooltipModule.forRoot({
      'placement': 'bottom',
      'hide-delay': 0,
      'displayTouchscreen': false,
    }),
  ],
  declarations: [
    EventPage,
    UpdateMatchPage,
  ]
})
export class EventPageModule {
}
