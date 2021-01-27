import {NgModule} from '@angular/core';
import {PreloadAllModules, RouterModule, Routes} from '@angular/router';

const routes: Routes = [
  {
    path: '',
    loadChildren: () =>
        import('./pages/home/home.module').then(m => m.HomePageModule),
  },
  {
    path: 'past',
    loadChildren: () =>
        import('./pages/past/past.module').then(m => m.PastPageModule),
  },
  {
    path: ':id',
    loadChildren: () =>
        import('./pages/event/event.module').then(m => m.EventPageModule),
  },
];

@NgModule({
  imports: [
    RouterModule.forRoot(routes, {preloadingStrategy: PreloadAllModules}),
  ],
  exports: [
    RouterModule,
  ]
})
export class AppRoutingModule {
}
