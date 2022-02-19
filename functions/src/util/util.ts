import * as admin from 'firebase-admin';
import {DocumentSnapshot} from 'firebase-functions/lib/providers/firestore';
import {GameSpeed} from '../../../types';

export function timeoutAfter<T>(ms: number, defaultValue: T): Promise<T> {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve(defaultValue);
    }, ms);
  });
}

const TURNS_MS = {
  [GameSpeed.SPEED_0_25X]: 4000,
  [GameSpeed.SPEED_0_5X]: 2000,
  [GameSpeed.SPEED_0_75X]: 1333.33,
  [GameSpeed.SPEED_1X]: 1000,
  [GameSpeed.SPEED_1_5X]: 666.66,
  [GameSpeed.SPEED_2X]: 500,
  [GameSpeed.SPEED_3X]: 333.33,
  [GameSpeed.SPEED_4X]: 250,
}

export function getFinishedTime(
    startTime: number,
    turns: number,
    speed = GameSpeed.SPEED_1X,
    ): number {
  return startTime + (turns * TURNS_MS[speed]);
}

export function keepLookingIn10Seconds(snapshot: DocumentSnapshot): Promise<void> {
  const {timesChecked = 0} = snapshot.data() ?? {};
  return new Promise(resolve => {
    if (timesChecked < 1000) {
      setTimeout(async () => {
        await snapshot.ref.update({
          timesChecked: admin.firestore.FieldValue.increment(1),
        });
        resolve();
      }, 10000);
    } else {
      // if we've checked 1000 times, that's nearly 3 hours, give up
      resolve();
    }
  });
}