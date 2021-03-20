import {Component, OnInit} from '@angular/core';
import Twitch from '../../../assets/twitch.js';

@Component({
  selector: 'app-wuped',
  templateUrl: './wuped.component.html',
  styleUrls: ['./wuped.component.scss'],
})
export class WupedComponent implements OnInit {
  constructor() {}

  ngOnInit() {
    new Twitch.Embed('twitch-embed', {
      width: '100%',
      height: '600',
      channel: 'wupedz',
    });
  }
}
