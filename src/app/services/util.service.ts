import {EventEmitter, Injectable} from '@angular/core';
import {AlertController, LoadingController, ToastController} from '@ionic/angular';

@Injectable({providedIn: 'root'})
export class UtilService {
  selectTab$ = new EventEmitter<string>();

  constructor(
      private readonly alertCtrl: AlertController,
      private readonly loadingCtrl: LoadingController,
      private readonly toastCtrl: ToastController,
  ) {}

  // Copies a string to the clipboard. Must be called from within an
  // event handler such as click. May return false if it failed, but
  // this is not always possible. Browser support for Chrome 43+,
  // Firefox 42+, Safari 10+, Edge and IE 10+.
  // IE: The clipboard feature may be disabled by an administrator. By
  // default a prompt is shown the first time the clipboard is
  // used (per session).
  copyToClipboard(text: string, successText = 'Copied link to clipboard') {
    if (document.queryCommandSupported &&
        document.queryCommandSupported('copy')) {
      const textarea = document.createElement('textarea');
      textarea.textContent = text;
      // Prevent scrolling to bottom of page in MS Edge.
      textarea.style.position = 'fixed';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        // Security exception may be thrown by some browsers.
        document.execCommand('copy');
        this.showToast(successText);
      } catch (ex) {
        this.showToast('Copy to clipboard failed');
        return false;
      } finally {
        document.body.removeChild(textarea);
      }
    }
  }

  async showToast(message: string, duration: number = 2000, options?) {
    const toast = await this.toastCtrl.create({message, duration, ...options});
    toast.present();
  }

  openLink(url: string) {
    window.open(url, '_system', 'location=yes');
  }

  /**
   * Show a confirmation popup, return true if they confirm
   */
  confirm(
      header: string, message: string, confirmText: string,
      cancelText: string): Promise<boolean> {
    return new Promise(async resolve => {
      const alert = await this.alertCtrl.create({
        header,
        message,
        buttons: [
          {
            text: cancelText,
            role: 'cancel',
            handler: () => {
              resolve(false);
            }
          },
          {
            text: confirmText,
            handler: () => {
              resolve(true);
            }
          }
        ]
      });

      await alert.present();
    });
  }

  /**
   * Present a loader with the given message, then return the loader
   * so the caller can dismiss it with loading.dismiss();
   */
  async presentLoader(message: string) {
    const loading = await this.loadingCtrl.create({message});
    await loading.present();
    return loading;
  }

  async promptForText(
      header: string,
      message: string,
      placeholder: string,
      confirmText: string,
      cancelText: string,
      ): Promise<string|null> {
    return new Promise(async resolve => {
      const ionAlert = await this.alertCtrl.create({
        cssClass: 'my-custom-class',
        header,
        message,
        inputs: [{name: 'name', type: 'text', placeholder}],
        buttons: [
          {
            text: cancelText,
            role: 'cancel',
            handler: () => {
              resolve(null);
            }
          },
          {
            text: confirmText,
            handler: (response) => {
              resolve(response.name || null)
            }
          }
        ]
      });

      await ionAlert.present();
    });
  }

  getDurationString(startTime: number, endTime: number): string {
    // short circuit when we fdon't have the info we need
    if (!startTime || !endTime) return '';

    const totalSeconds = (endTime - startTime) / 1000;
    const days = Math.floor(totalSeconds / (60 * 60 * 12));
    const hours = Math.floor(totalSeconds / (60 * 60));
    const mins = Math.floor(totalSeconds / 60 % 60);
    const secs = Math.ceil(totalSeconds % 60);
    return `
      ${days ? days + 'd ' : ''}
      ${hours ? hours + 'h ' : ''}
      ${mins ? mins + 'm' : ''}
      ${secs ? secs + 's' : ''}
    `.trim();
  }

  getParamString(params: {[key: string]: any}): string {
    if (!params) return '';

    let str = '';
    const entries = Object.entries(params);
    for (let i = 0; i < entries.length; i++) {
      const [key, value] = entries[i];
      str += i === 0 ? '?' : '&';
      str += `${key}=${value ?? ''}`;
    }

    return str;
  }

  selectTab(tab: string) {
    this.selectTab$.emit(tab);
  }
}
