import {Component, Input, OnInit} from '@angular/core';
import {EventStatus} from 'types.js';
import Twitch from '../../../assets/twitch.js';

@Component({
  selector: 'app-twitch',
  templateUrl: './twitch.component.html',
  styleUrls: ['./twitch.component.scss'],
})
export class TwitchComponent implements OnInit {
  @Input() status: EventStatus;
  @Input() channel: string;

  constructor() {}

  ngOnInit() {
    if (!this.finished) {
      new Twitch.Embed('twitch-embed', {
        width: '100%',
        height: '600',
        channel: this.channel,
      });
    }
  }

  get finished(): boolean {
    return this.status === EventStatus.FINISHED;
  }
}
