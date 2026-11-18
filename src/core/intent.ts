import type { Preset } from './domain';

export type Plan =
  | { action: 'inspect' | 'measure' | 'compare' | 'review' | 'help' }
  | { action: 'view'; preset: Preset };
export type Connector = { mode: 'local' | 'connector'; label: string; destination?: string };
export const LOCAL: Connector = { mode: 'local', label: 'Local engine' };
export const PRESETS = ['iso', 'front', 'top', 'right', 'back'] as const;
export function safePlan(value: unknown): Plan | null {
  if (!value || typeof value !== 'object' || !('action' in value)) return null;
  const action = value.action;
  if (action === 'view' && 'preset' in value && PRESETS.some((p) => p === value.preset))
    return { action, preset: value.preset as Preset };
  if (
    action === 'inspect' ||
    action === 'compare' ||
    action === 'measure' ||
    action === 'review' ||
    action === 'help'
  )
    return { action };
  return null;
}

// A small local grammar. Intentionally never aliases arbitrary text to system commands.
export function localPlan(input: string): Plan {
  const text = input.toLowerCase().trim();
  const askToSave = /\b(save|prepare|make|stage|capture|create|record|annotate)\b/.test(text);
  if (/\b(compare|difference|diff|changed|delta|baseline)\b/.test(text))
    return { action: askToSave ? 'review' : 'compare' };
  if (/\b(review|bookmark|save (this |a )?view)\b/.test(text)) return { action: 'review' };
  if (/\b(measure|spacing|distance|dimension)\b/.test(text)) return { action: 'measure' };
  if (/\b(inspect|describe|metadata|information|source|parts)\b/.test(text))
    return { action: 'inspect' };
  if (/\b(view|show|switch|look)\b/.test(text)) {
    const preset = PRESETS.find((p) => new RegExp(`\\b${p}\\b`).test(text));
    if (preset) return { action: 'view', preset };
  }
  return { action: 'help' };
}
