// Typed bridge to the canonical event game-option normalization implemented
// in functions/src/util/EventGameOptions.js (plain JS so the vanilla-node
// simulator can use it). Keeping one implementation prevents the frontend and
// backend modifier registries from drifting apart.

import {IGeneralsGameOptions, IModifierOptions} from 'types';

declare function require(name: string): any;

const EventGameOptions = require('./functions/src/util/EventGameOptions.js');

export interface IEventModifier {
  id: number;
  name: string;
  exclude: number[];
}

export const MODIFIERS: IEventModifier[] = EventGameOptions.MODIFIERS;
export const MODIFIER_INDEXES = EventGameOptions.MODIFIER_INDEXES;

export function normalizeModifierIds(
    modifiers: string|number[]|string[]|null|undefined): number[] {
  return EventGameOptions.normalizeModifierIds(modifiers);
}

export function normalizeModifierOptions(raw: any): IModifierOptions|undefined {
  return EventGameOptions.normalizeModifierOptions(raw);
}

export function normalizeEventGameOptions(
    options: Partial<IGeneralsGameOptions>|null|undefined):
    Partial<IGeneralsGameOptions> {
  return EventGameOptions.normalizeEventGameOptions(options);
}

export function validateEventGameOptions(
    options: Partial<IGeneralsGameOptions>|null|undefined):
    {valid: boolean, normalized?: Partial<IGeneralsGameOptions>,
     error?: string} {
  return EventGameOptions.validateEventGameOptions(options);
}
