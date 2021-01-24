import {Component, Input} from '@angular/core';

@Component({
  selector: 'app-crown',
  templateUrl: './crown.component.html',
  styleUrls: ['./crown.component.scss'],
})
export class CrownComponent {
  private _color = 'teal';

  @Input()
  set color(color: string) {
    if (color) this._color = color;
  }
  get color(): string {
    return this._color;
  }
}
