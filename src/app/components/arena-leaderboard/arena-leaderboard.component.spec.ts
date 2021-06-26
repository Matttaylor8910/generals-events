import {async, ComponentFixture, TestBed} from '@angular/core/testing';
import {IonicModule} from '@ionic/angular';

import {ArenaLeaderboardComponent} from './arena-leaderboard.component';

describe('ArenaLeaderboardComponent', () => {
  let component: ArenaLeaderboardComponent;
  let fixture: ComponentFixture<ArenaLeaderboardComponent>;

  beforeEach(async(() => {
    TestBed
        .configureTestingModule({
          declarations: [ArenaLeaderboardComponent],
          imports: [IonicModule.forRoot()]
        })
        .compileComponents();

    fixture = TestBed.createComponent(ArenaLeaderboardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
