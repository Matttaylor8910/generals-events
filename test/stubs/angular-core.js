'use strict';

// minimal @angular/core stand-in: decorators are no-ops, EventEmitter is a
// synchronous emitter so component field initializers work

class EventEmitter {
  constructor() {
    this._subs = [];
  }
  emit(value) {
    this._subs.forEach(fn => fn(value));
  }
  next(value) {
    this.emit(value);
  }
  subscribe(fn) {
    this._subs.push(fn);
    return { unsubscribe() {} };
  }
  pipe() {
    return this;
  }
}

const classDecorator = () => target => target;
const propDecorator = () => () => {};

module.exports = {
  Injectable: classDecorator,
  Component: classDecorator,
  Directive: classDecorator,
  NgModule: classDecorator,
  Pipe: classDecorator,
  Input: propDecorator,
  Output: propDecorator,
  HostListener: propDecorator,
  ViewChild: propDecorator,
  EventEmitter,
};
