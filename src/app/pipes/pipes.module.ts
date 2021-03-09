import {NgModule} from '@angular/core';
import {HttpPipe} from './http.pipe';

@NgModule({
  imports: [],
  declarations: [
    HttpPipe,
  ],
  exports: [
    HttpPipe,
  ]
})
export class PipesModule {
}
