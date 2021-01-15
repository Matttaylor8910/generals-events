import {Component} from '@angular/core';
import {ModalController} from '@ionic/angular';
import {Observable} from 'rxjs';
import {GeneralsService} from 'src/app/services/generals.service';
import {TournamentService} from 'src/app/services/tournament.service';
import {ITournament} from 'types';

import {ADMINS} from '../../../../constants';

import {CreateTournamentPage} from './create-tournament/create-tournament.page';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
})
export class HomePage {
  unfinishedTournaments$: Observable<ITournament[]>;
  finishedTournaments$: Observable<ITournament[]>;

  constructor(
      private readonly tournamentService: TournamentService,
      private readonly modalController: ModalController,
      private readonly generals: GeneralsService,
  ) {
    this.unfinishedTournaments$ = this.tournamentService.getTournaments(false);
    this.finishedTournaments$ = this.tournamentService.getTournaments(true);
  }

  get canCreateEvent() {
    return ADMINS.includes(this.generals.name);
  }

  async createTournament() {
    const modal = await this.modalController.create({
      component: CreateTournamentPage,
      cssClass: 'my-custom-class',
      componentProps: {
        'firstName': 'Douglas',
        'lastName': 'Adams',
        'middleInitial': 'N',
      },
    });
    return await modal.present();
  }
}
