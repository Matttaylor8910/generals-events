import { async, ComponentFixture, TestBed } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular';

import { TournamentTrophyPlayerComponent } from './tournament-trophy-player.component';

describe('TournamentTrophyPlayerComponent', () => {
  let component: TournamentTrophyPlayerComponent;
  let fixture: ComponentFixture<TournamentTrophyPlayerComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ TournamentTrophyPlayerComponent ],
      imports: [IonicModule.forRoot()]
    }).compileComponents();

    fixture = TestBed.createComponent(TournamentTrophyPlayerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
