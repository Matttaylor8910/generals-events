import {Component, Input} from '@angular/core';
import {Router} from '@angular/router';
import {PopoverAction as IPopoverAction} from 'src/app/components/actions-popover/actions-popover.component';
import {EventService} from 'src/app/services/event.service';
import {GeneralsService} from 'src/app/services/generals.service';

import {GeneralsServer} from '../../../../constants';
import {EventStatus} from '../../../../types';

// the query param generals.io sends us back with after a login
const HANDOFF_TOKEN_PARAM = 'handoffToken';

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
      private readonly router: Router,
  ) {
    this.checkHandoffToken();
    this.ngOnChanges();
  }

  /**
   * If generals.io just sent us a signed handoff token, trade it for a login.
   * A bare username in the url or a postMessage is never trusted.
   */
  async checkHandoffToken() {
    const token = new URLSearchParams(location.search).get(HANDOFF_TOKEN_PARAM);
    if (!token) return;

    const loggedIn =
        await this.generals.loginWithHandoffToken(token, this.eventId);

    // on success handleDidLogin navigates away, on failure drop the token
    if (!loggedIn) {
      this.router.navigate([], {queryParams: {}, replaceUrl: true});
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
  }
}
