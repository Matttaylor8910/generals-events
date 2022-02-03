import {Pipe, PipeTransform} from '@angular/core';
import {DomSanitizer} from '@angular/platform-browser';

@Pipe({name: 'http'})
export class HttpPipe implements PipeTransform {
  constructor(private _domSanitizer: DomSanitizer) {}

  transform(value: any, args?: any): any {
    return this._domSanitizer.bypassSecurityTrustHtml(this.stylize(value));
  }

  // From https://stackoverflow.com/a/65272554/2943405
  private stylize(text: string): string {
    let stylizedText: string = '';
    if (text && text.length > 0) {
      text = this.strip(text);
      for (let line of text.split('\n')) {
        for (let t of line.split(' ')) {
          if (t.startsWith('http') && t.length > 7) {
            stylizedText += `<a target="_blank" href="${t}">${t}</a> `;
          } else
            stylizedText += t + ' ';
        }
        stylizedText += '<br>';
      }
      return stylizedText;
    } else
      return text;
  }

  // From https://stackoverflow.com/a/47140708
  private strip(html: string) {
    let doc = new DOMParser().parseFromString(html, 'text/html');
    return doc.body.textContent || '';
  }
}