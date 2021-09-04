import {Component, Input, OnDestroy} from '@angular/core';
import {Router} from '@angular/router';
import {PopoverAction as IPopoverAction} from 'src/app/components/actions-popover/actions-popover.component';
import {EventService} from 'src/app/services/event.service';
import {GeneralsService} from 'src/app/services/generals.service';

import {GeneralsServer, SITE_URLS} from '../../../../constants';
import {EventStatus} from '../../../../types';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
})
export class LoginComponent implements OnDestroy {
  @Input() eventId?: string;
  @Input() status?: EventStatus;
  @Input() server = GeneralsServer.NA;
  @Input() disqualified = false;

  actions: IPopoverAction[];
  generalsio = SITE_URLS[GeneralsServer.NA];
  listener;

  constructor(
      public readonly generals: GeneralsService,
      private readonly eventService: EventService,
      private readonly router: Router,
  ) {
    this.checkUserParam();
    this.ngOnChanges();

    this.listener = window.addEventListener('message', event => {
      // Ensure the message is coming from generals.io
      if (event.origin !== this.generalsio) return;

      // if the username was passed back, save it
      if (event.data?.length > 0) {
        this.generals.handleDidLogin(event.data, this.eventId);
      }
    });
  }

  async checkUserParam() {
    if (location.href.includes('encryptedUser=')) {
      const param = location.href.split('encryptedUser=')[1].split('&')[0];
      const decoded = decodeURIComponent(param);
      const decrypted = await this.generals.decryptUsername(decoded);
      this.generals.handleDidLogin(decrypted, this.eventId);
    }
  }

  logout() {
    const {eventId, status, generals: {name}} = this;
    if (name && eventId && status !== EventStatus.FINISHED &&
        !this.disqualified) {
      this.eventService.leaveQueue(eventId, name);
    }
    this.generals.logout();
  }

  goToProfile() {
    this.generals.goToProfile(this.generals.name);
  }

  ngOnChanges() {
    this.actions = [{label: 'Logout', onClick: () => this.logout()}];
    this.checkIframeForUsername();
  }

  private checkIframeForUsername() {
    const iframe = document.getElementById('generals') as HTMLIFrameElement;
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage('username', this.generalsio);
    }
  }

  ngOnDestroy() {
    window.removeEventListener('message', this.listener);
  }
}
