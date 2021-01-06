import {CommonModule} from '@angular/common';
import {NgModule} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {IonicModule} from '@ionic/angular';
import {ComponentsModule} from 'src/app/components/components.module';

import {TournamentPageRoutingModule} from './tournament-routing.module';
import {TournamentPage} from './tournament.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    TournamentPageRoutingModule,
    ComponentsModule,
  ],
  declarations: [
    TournamentPage,
  ]
})
export class TournamentPageModule {
}
