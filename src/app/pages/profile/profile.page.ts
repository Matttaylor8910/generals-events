import {Component} from '@angular/core';
import {ActivatedRoute} from '@angular/router';
import {Observable} from 'rxjs';
import {take, tap} from 'rxjs/operators';
import {GeneralsService} from 'src/app/services/generals.service';
import {ProfileService} from 'src/app/services/profile.service';
import {IGeneralsReplay, IPlayerProfile, PlayerProfileStatus} from 'types';

@Component({
  selector: 'app-profile',
  templateUrl: './profile.page.html',
  styleUrls: ['./profile.page.scss'],
})
export class ProfilePage {
  name: string;

  status: PlayerProfileStatus;
  profile$: Observable<IPlayerProfile>;
  replays$: Observable<IGeneralsReplay[]>

  constructor(
      public readonly generals: GeneralsService,
      private readonly route: ActivatedRoute,
      private readonly profileService: ProfileService,
  ) {
    this.name = this.route.snapshot.params.name;
    this.profile$ =
        this.profileService.getProfile(this.name).pipe(tap(profile => {
          this.status = profile.status;
          if (!profile.exists) {
            this.getGames();
          }
        }));

    this.replays$ = this.profileService.getReplays(this.name);
  }

  get loaded() {
    return this.status === PlayerProfileStatus.LOADED;
  }

  getGames() {
    this.generals.getReplaysForUser(this.name);
  }

  getReplays() {
    this.profileService.getReplays(this.name).pipe(take(1)).subscribe(
        replays => {
          console.log(replays);
        });
  }
}
