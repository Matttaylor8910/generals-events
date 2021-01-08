import {Component, Input} from '@angular/core';
import {PopoverAction as IPopoverAction} from 'src/app/components/actions-popover/actions-popover.component';
import {GeneralsService} from 'src/app/services/generals.service';
import {ITournament} from 'types';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
})
export class LoginComponent {
  @Input() tournament?: ITournament;

  actions: IPopoverAction[];

  constructor(
      public readonly generals: GeneralsService,
  ) {
    this.checkUserParam();
    this.ngOnChanges();
  }

  async checkUserParam() {
    if (location.href.includes('encryptedUser=')) {
      const param = location.href.split('encryptedUser=')[1];
      const decoded = decodeURIComponent(param);
      const decrypted = await this.generals.decryptUsername(decoded);
      this.generals.setName(decrypted);
    }
  }

  ngOnChanges() {
    this.actions = [{
      label: 'Logout',
      onClick: () => this.generals.logout(this.tournament?.id)
    }];
  }
}
