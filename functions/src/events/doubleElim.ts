import {DocumentSnapshot} from 'firebase-functions/lib/providers/firestore';
import {IDoubleElimEvent} from '../../../types';

export function handleDoubleElimEventUpdate(
    snapshot: DocumentSnapshot, eventId: string) {
  const event = snapshot.data() as IDoubleElimEvent;
  // TODO
}