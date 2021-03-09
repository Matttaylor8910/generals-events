import { HttpPipe } from './http.pipe';

describe('HttpPipe', () => {
  it('create an instance', () => {
    const pipe = new HttpPipe();
    expect(pipe).toBeTruthy();
  });
});
