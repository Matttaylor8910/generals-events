import {Component, Input} from '@angular/core';
import {GeneralsServer} from 'constants';
import {PopoverAction as IPopoverAction} from 'src/app/components/actions-popover/actions-popover.component';
import {GeneralsService} from 'src/app/services/generals.service';
import {TournamentService} from 'src/app/services/tournament.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.scss'],
})
export class LoginComponent {
  @Input() tournamentId?: string;
  @Input() server = GeneralsServer.NA;

  actions: IPopoverAction[];

  constructor(
      public readonly generals: GeneralsService,
      private readonly tournamentService: TournamentService,
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
      this.generals.handleDidLogin(decrypted, this.tournamentId);
    }
  }

  logout() {
    const {tournamentId, generals: {name}} = this;
    if (tournamentId && name) {
      this.tournamentService.removePlayer(tournamentId, name);
      this.tournamentService.leaveQueue(tournamentId, name);
    }
    this.generals.logout();
  }

  ngOnChanges() {
    this.actions = [{label: 'Logout', onClick: () => this.logout()}];
  }
}
