import {Component, Input} from '@angular/core';
import {PopoverAction as IPopoverAction} from 'src/app/components/actions-popover/actions-popover.component';
import {EventService} from 'src/app/services/event.service';
import {GeneralsService} from 'src/app/services/generals.service';

import {GeneralsServer} from '../../../../constants';
import {EventStatus} from '../../../../types';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
})
export class LoginComponent {
  @Input() eventId?: string;
  @Input() status?: EventStatus;
  @Input() server = GeneralsServer.NA;
  @Input() disqualified = false;

  actions: IPopoverAction[];

  constructor(
      public readonly generals: GeneralsService,
      private readonly eventService: EventService,
  ) {
    this.checkUserParam();
    this.ngOnChanges();
  }

  async checkUserParam() {
    if (location.href.includes('encryptedUser=')) {
      const param = location.href.split('encryptedUser=')[1].split('&')[0];
      const decoded = decodeURIComponent(param);
      console.log(`decoded param: ${decoded}`);
      const decrypted = await this.generals.decryptUsername(decoded);
      this.generals.handleDidLogin(decrypted, this.eventId);
    }
  }

  logout() {
    const {eventId, status, generals: {name}} = this;
    if (name && eventId && status !== EventStatus.FINISHED &&
        !this.disqualified) {
      this.eventService.removePlayer(eventId, name);
      this.eventService.leaveQueue(eventId, name);
    }
    this.generals.logout();
  }

  ngOnChanges() {
    this.actions = [{label: 'Logout', onClick: () => this.logout()}];
  }
}
