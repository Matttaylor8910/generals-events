import { async, ComponentFixture, TestBed } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular';

import { TournamentLeaderboardPlayerComponent } from './tournament-leaderboard-player.component';

describe('TournamentLeaderboardPlayerComponent', () => {
  let component: TournamentLeaderboardPlayerComponent;
  let fixture: ComponentFixture<TournamentLeaderboardPlayerComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ TournamentLeaderboardPlayerComponent ],
      imports: [IonicModule.forRoot()]
    }).compileComponents();

    fixture = TestBed.createComponent(TournamentLeaderboardPlayerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
