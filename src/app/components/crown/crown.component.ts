import {Component, Input} from '@angular/core';

@Component({
  selector: 'app-crown',
  templateUrl: './crown.component.html',
  styleUrls: ['./crown.component.scss'],
})
export class CrownComponent {
  @Input() color = 'teal';
}
