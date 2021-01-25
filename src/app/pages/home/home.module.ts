import {CommonModule} from '@angular/common';
import {NgModule} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {IonicModule} from '@ionic/angular';
import {ComponentsModule} from 'src/app/components/components.module';
import {CreateEventPage} from './create-event/create-event.page';

import {HomePageRoutingModule} from './home-routing.module';
import {HomePage} from './home.page';


@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    HomePageRoutingModule,
    ComponentsModule,
  ],
  declarations: [
    HomePage,
    CreateEventPage,
  ]
})
export class HomePageModule {
}
