import { TestBed } from '@angular/core/testing';

import { AuthGoogle } from './auth-google';

describe('AuthGoogle', () => {
  let service: AuthGoogle;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(AuthGoogle);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
