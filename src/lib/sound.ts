export type SoundRole = 'host' | 'display' | 'player';
export type SoundCue = 'tick' | 'time-up' | 'correct' | 'wrong' | 'cell-claimed' | 'win';
type Note = [frequency: number, offset: number, duration: number];

const cues: Record<SoundCue, Note[]> = {
  tick: [[740, 0, 0.055]],
  'time-up': [[435, 0, 0.12], [295, 0.13, 0.16]],
  correct: [[523, 0, 0.065], [659, 0.075, 0.08], [784, 0.165, 0.1]],
  wrong: [[330, 0, 0.09], [247, 0.1, 0.13]],
  'cell-claimed': [[392, 0, 0.1], [587, 0.045, 0.13]],
  win: [[523, 0, 0.105], [659, 0.12, 0.105], [784, 0.24, 0.105], [1047, 0.36, 0.23]],
};

export const soundPreferenceKey = 'almaidan-sound';
const listeners = new Set<() => void>();
let preference: boolean | undefined;
let context: AudioContext | undefined;
let resume: Promise<void> | undefined;
let nextCueAt = 0;
const playing = new Set<OscillatorNode>();

function readPreference(): boolean | undefined {
  try {
    const value = window.localStorage.getItem(soundPreferenceKey);
    if (value === 'on') return true;
    if (value === 'off') return false;
  } catch { /* Sound still works when storage is disabled. */ }
}

export function soundEnabled(role: SoundRole): boolean {
  return preference ?? readPreference() ?? role !== 'player';
}

function stopSound() {
  for (const oscillator of playing) oscillator.stop();
  playing.clear();
  nextCueAt = 0;
}

export function setSoundEnabled(enabled: boolean) {
  preference = enabled;
  if (!enabled) stopSound();
  try {
    window.localStorage.setItem(soundPreferenceKey, enabled ? 'on' : 'off');
  } catch { /* Keep the choice for this visit. */ }
  listeners.forEach(listener => listener());
}

export function subscribeSoundPreference(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== soundPreferenceKey && event.key !== null) return;
    preference = readPreference();
    if (preference !== true) stopSound();
    listener();
  };
  listeners.add(listener);
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function listenForSoundActivation() {
  const activate = (event: Event) => {
    if (!event.isTrusted || (event instanceof KeyboardEvent && event.repeat)) return;
    try {
      const Audio = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Audio) return;
      context ??= new Audio();
      if (context.state !== 'running' && !resume) {
        resume = context.resume().catch(() => {}).finally(() => { resume = undefined; });
      }
    } catch { /* The game remains playable without Web Audio. */ }
  };
  document.addEventListener('click', activate, true);
  document.addEventListener('keydown', activate, true);
  return () => {
    document.removeEventListener('click', activate, true);
    document.removeEventListener('keydown', activate, true);
  };
}

export function playSounds(role: SoundRole, ...names: SoundCue[]) {
  const audio = context;
  if (!audio || audio.state !== 'running' || document.hidden || !soundEnabled(role)) return;
  for (const name of names) {
    const start = Math.max(audio.currentTime, nextCueAt);
    let end = start;
    for (const [frequency, offset, duration] of cues[name]) {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      const begin = start + offset;
      const finish = begin + duration;
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, begin);
      gain.gain.setValueAtTime(0, begin);
      gain.gain.linearRampToValueAtTime(0.09, begin + 0.01);
      gain.gain.linearRampToValueAtTime(0, finish);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.onended = () => {
        playing.delete(oscillator);
        oscillator.disconnect();
        gain.disconnect();
      };
      playing.add(oscillator);
      oscillator.start(begin);
      oscillator.stop(finish);
      end = Math.max(end, finish);
    }
    nextCueAt = end + 0.02;
  }
}
