'use strict';

// passthrough rxjs operators; the reactive data paths are not exercised by
// the behavioral tests, these only need to exist and chain
const passthrough = () => src => src;

// map applies the projection directly to the emitted value: the fake
// observables the tests build pipe plain payloads through the operator
// chain, so the real projection code inside map(...) still runs
const map = fn => src => fn(src);

module.exports = {
  map,
  takeUntil: passthrough,
  filter: passthrough,
  switchMap: passthrough,
  mergeMap: passthrough,
  tap: passthrough,
  catchError: passthrough,
};
