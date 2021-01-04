import { async, ComponentFixture, TestBed } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular';

import { PastPage } from './past.page';

describe('PastPage', () => {
  let component: PastPage;
  let fixture: ComponentFixture<PastPage>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ PastPage ],
      imports: [IonicModule.forRoot()]
    }).compileComponents();

    fixture = TestBed.createComponent(PastPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
