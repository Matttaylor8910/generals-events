import {Component, Input, SimpleChanges} from '@angular/core';
import {ITournament} from 'types';

@Component({
  selector: 'app-timer',
  templateUrl: './timer.component.html',
  styleUrls: ['./timer.component.scss'],
})
export class TimerComponent {
  @Input() stopAt: number;

  clock = '';
  seconds: number;
  lastStopAt: number;
  timeout: any;  // NodeJS.Timeout;

  constructor() {}

  ngOnInit() {
    this.calculateClock();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes.endTime) {
      this.calculateClock();
    }
  }
  calculateClock() {
    const timerRelativeTo = Date.now();
    this.seconds = (this.stopAt - timerRelativeTo) / 1000;
    this.clock = this.fancyTimeFormat(this.seconds);

    // determine the amount of time to the middle of the next second
    const timeToWait = (1500 - (Date.now() % 1000)) % 1000;
    this.timeout = setTimeout(this.calculateClock.bind(this), timeToWait);
  }

  fancyTimeFormat(seconds: number) {
    if (seconds <= 0) {
      return '0:00';
    }

    // Hours, minutes and seconds
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds) % 60;

    // Output like '1:01' or '4:03:59' or '123:03:59'
    let ret = '';

    if (hrs > 0) {
      ret += '' + hrs + ':' + (mins < 10 ? '0' : '');
    }

    ret += '' + mins + ':' + (secs < 10 ? '0' : '');
    ret += '' + secs;
    return ret;
  }

  ngOnDestroy() {
    clearTimeout(this.timeout);
  }
}
