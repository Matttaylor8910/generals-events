import {Component} from '@angular/core';
import {ModalController} from '@ionic/angular';
import {Observable} from 'rxjs';
import {TournamentService} from 'src/app/services/tournament.service';
import {ITournament} from 'types';
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
  ) {
    this.unfinishedTournaments$ = this.tournamentService.getTournaments(false);
    this.finishedTournaments$ = this.tournamentService.getTournaments(true);
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

  // this.tournamentService.createTournament({
  //   durationMinutes: 60,
  //   playersPerGame: 8,
  // });
}
