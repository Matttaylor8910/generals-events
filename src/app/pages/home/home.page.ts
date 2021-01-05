import {Component} from '@angular/core';
import {ModalController} from '@ionic/angular';
import {TournamentService} from 'src/app/services/tournament.service';
import {CreateTournamentPage} from './create-tournament/create-tournament.page';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
})
export class HomePage {
  constructor(
      private readonly tournamentService: TournamentService,
      private readonly modalController: ModalController,
  ) {}

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
