import {NgModule} from '@angular/core';
import {HttpPipe} from './http.pipe';
import {SafePipe} from './safe.pipe';

@NgModule({
  imports: [],
  declarations: [
    HttpPipe,
    SafePipe,
  ],
  exports: [
    HttpPipe,
    SafePipe,
  ]
})
export class PipesModule {
}
