'use strict';

// minimal rxjs stand-in; pipe returns the same observable so constructor
// wiring like subject.pipe(takeUntil(x)).subscribe(...) still runs
class Subscription {
  unsubscribe() {}
}

class Observable {
  pipe(...ops) {
    return ops.reduce((src, op) => op(src), this);
  }
  subscribe() {
    return new Subscription();
  }
}

class Subject extends Observable {
  next() {}
}

module.exports = {
  Observable,
  Subject,
  Subscription,
  BehaviorSubject: Subject,
  of: () => new Observable(),
  EMPTY: new Observable(),
};
