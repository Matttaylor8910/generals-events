import {CommonModule} from '@angular/common';
import {NgModule} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {IonicModule} from '@ionic/angular';
import {ComponentsModule} from 'src/app/components/components.module';

import {EventPageRoutingModule} from './event-routing.module';
import {EventPage} from './event.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    EventPageRoutingModule,
    ComponentsModule,
  ],
  declarations: [
    EventPage,
  ]
})
export class EventPageModule {
}
