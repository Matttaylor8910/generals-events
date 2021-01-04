import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { IonicModule } from '@ionic/angular';

import { PastPageRoutingModule } from './past-routing.module';

import { PastPage } from './past.page';

@NgModule({
  imports: [
    CommonModule,
    FormsModule,
    IonicModule,
    PastPageRoutingModule
  ],
  declarations: [PastPage]
})
export class PastPageModule {}
