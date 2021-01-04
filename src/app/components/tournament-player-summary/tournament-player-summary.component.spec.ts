import { async, ComponentFixture, TestBed } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular';

import { TournamentPlayerSummaryComponent } from './tournament-player-summary.component';

describe('TournamentPlayerSummaryComponent', () => {
  let component: TournamentPlayerSummaryComponent;
  let fixture: ComponentFixture<TournamentPlayerSummaryComponent>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ TournamentPlayerSummaryComponent ],
      imports: [IonicModule.forRoot()]
    }).compileComponents();

    fixture = TestBed.createComponent(TournamentPlayerSummaryComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
