import { TestBed } from '@angular/core/testing';

import { GeneralsService } from './generals.service';

describe('GeneralsService', () => {
  let service: GeneralsService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(GeneralsService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
