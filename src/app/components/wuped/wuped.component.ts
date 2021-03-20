import {Component, Input, OnInit} from '@angular/core';
import {EventStatus} from 'types.js';
import Twitch from '../../../assets/twitch.js';

@Component({
  selector: 'app-wuped',
  templateUrl: './wuped.component.html',
  styleUrls: ['./wuped.component.scss'],
})
export class WupedComponent implements OnInit {
  @Input() status: EventStatus;

  constructor() {}

  ngOnInit() {
    if (!this.finished) {
      new Twitch.Embed('twitch-embed', {
        width: '100%',
        height: '600',
        channel: 'wupedz',
      });
    }
  }

  get finished(): boolean {
    return this.status === EventStatus.FINISHED;
  }
}
