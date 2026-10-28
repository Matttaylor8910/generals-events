'use strict';

// minimal @angular/common stand-in supporting the two date formats the
// create-event page uses
class DatePipe {
  constructor(locale) {
    this.locale = locale;
  }
  transform(value, format) {
    const d = new Date(value);
    const pad = n => String(n).padStart(2, '0');
    if (format === 'yyyy-MM-dd') {
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }
    if (format === 'HH:mm:ss') {
      return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }
    return d.toISOString();
  }
}

module.exports = { DatePipe };
