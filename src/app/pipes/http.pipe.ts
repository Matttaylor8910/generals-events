import {Pipe, PipeTransform} from '@angular/core';

@Pipe({name: 'http'})
export class HttpPipe implements PipeTransform {
  transform(value: string): string {
    // Return ordinary HTML so Angular's sanitizer remains a second boundary.
    return this.stylize(typeof value === 'string' ? value : '');
  }

  private stylize(text: string): string {
    let stylizedText: string = '';
    if (text && text.length > 0) {
      for (let line of text.split('\n')) {
        for (let t of line.split(' ')) {
          // Escape both attribute and text contexts; never decode entities first.
          const escaped = this.escape(t);
          if (/^https?:\/\/[^\s]+$/i.test(t)) {
            stylizedText += `<a target="_blank" rel="noopener noreferrer" href="${escaped}">${escaped}</a> `;
          } else
            stylizedText += escaped + ' ';
        }
        stylizedText += '<br>';
      }
      return stylizedText;
    } else {
      return text;
    }
  }

  private escape(text: string): string {
    return text.replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
  }
}