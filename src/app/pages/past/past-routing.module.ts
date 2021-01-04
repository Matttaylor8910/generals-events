import { NgModule } from '@angular/core';
import { Routes, RouterModule } from '@angular/router';

import { PastPage } from './past.page';

const routes: Routes = [
  {
    path: '',
    component: PastPage
  }
];

@NgModule({
  imports: [RouterModule.forChild(routes)],
  exports: [RouterModule],
})
export class PastPageRoutingModule {}
