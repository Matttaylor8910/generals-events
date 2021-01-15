import {DatePipe} from '@angular/common';
import {Component} from '@angular/core';
import {ModalController} from '@ionic/angular';
import {TournamentService} from 'src/app/services/tournament.service';
import {TournamentType} from 'types';

const tournamentTypes = {
  [TournamentType.FFA]: {
    name: 'FFA',
    playersPerGame: 8,
  },
  [TournamentType.ONE_VS_ONE]: {
    name: '1v1',
    playersPerGame: 2,
  },
}

const months = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov',
  'Dec'
];

@Component({
  selector: 'app-create-tournament',
  templateUrl: './create-tournament.page.html',
  styleUrls: ['./create-tournament.page.scss'],
})
export class CreateTournamentPage {
  types = Object.keys(tournamentTypes);
  type = this.types[0];

  date = new DatePipe('en-US').transform(new Date(), 'yyyy-MM-dd');
  time = '12:00:00';

  duration: number;
  name: string;

  saving = false;

  constructor(
      private readonly tournamentService: TournamentService,
      private readonly modalController: ModalController,
  ) {}

  get namePlaceholder(): string {
    const date = new Date(this.date);
    const year = date.getFullYear();
    const month = months[date.getMonth()];
    return `${this.type}-${month}-${year}`;
  }

  get invalidDate(): boolean {
    const date = this.getDate();
    return date.getTime() !== date.getTime();
  }

  get invalid(): boolean {
    return this.invalidDate || !this.duration || this.saving;
  }

  getDate(): Date {
    return new Date(`${this.date}T${this.time}`);
  }

  async create() {
    this.saving = true;
    await this.tournamentService.createTournament({
      name: this.name || this.namePlaceholder,
      type: this.type as TournamentType,
      startTime: this.getDate().getTime(),
      playersPerGame: tournamentTypes[this.type].playersPerGame,
      durationMinutes: Number(this.duration),
    });
    this.modalController.dismiss();
  }
}
