import { async, ComponentFixture, TestBed } from '@angular/core/testing';
import { IonicModule } from '@ionic/angular';

import { UpdateMatchPage } from './update-match.page';

describe('UpdateMatchPage', () => {
  let component: UpdateMatchPage;
  let fixture: ComponentFixture<UpdateMatchPage>;

  beforeEach(async(() => {
    TestBed.configureTestingModule({
      declarations: [ UpdateMatchPage ],
      imports: [IonicModule.forRoot()]
    }).compileComponents();

    fixture = TestBed.createComponent(UpdateMatchPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }));

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
