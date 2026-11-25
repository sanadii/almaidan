import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const soundModule = () => import('../../src/lib/sound');

function fakeAudio(state: AudioContextState = 'running') {
  const oscillators: ReturnType<typeof createOscillator>[] = [];
  const audio = {
    currentTime: 10,
    state,
    destination: {},
    resume: vi.fn(async () => { audio.state = 'running'; }),
    createOscillator: vi.fn(() => {
      const oscillator = createOscillator();
      oscillators.push(oscillator);
      return oscillator;
    }),
    createGain: vi.fn(() => ({
      gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() },
      connect: vi.fn(), disconnect: vi.fn(),
    })),
  };
  const constructor = vi.fn(function AudioContext() { return audio; });
  vi.stubGlobal('AudioContext', constructor);
  return { audio, constructor, oscillators };
}

function createOscillator() {
  return {
    connect: vi.fn((gain: unknown) => gain), disconnect: vi.fn(),
    frequency: { setValueAtTime: vi.fn() }, start: vi.fn(), stop: vi.fn(),
  };
}

async function activateSound() {
  const sound = await soundModule();
  const subscribe = vi.spyOn(document, 'addEventListener');
  const dispose = sound.listenForSoundActivation();
  const activate = subscribe.mock.calls.find(([type]) => type === 'click')?.[1] as EventListener;
  return { sound, activate, dispose };
}

beforeEach(() => {
  vi.resetModules();
  window.localStorage.clear();
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('waits for trusted input and resumes one shared AudioContext', async () => {
  const { constructor, audio, oscillators } = fakeAudio('suspended');
  const { sound, activate, dispose } = await activateSound();
  try {
    sound.playSounds('host', 'win');
    document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(constructor).not.toHaveBeenCalled();
    activate({ isTrusted: true } as Event);
    activate({ isTrusted: true } as Event);
    expect(constructor).toHaveBeenCalledTimes(1);
    expect(audio.resume).toHaveBeenCalledTimes(1);
    sound.playSounds('host', 'tick');
    expect(oscillators[0].frequency.setValueAtTime).toHaveBeenCalledWith(740, 10);
    expect(oscillators[0].stop).toHaveBeenCalledWith(10.055);
  } finally { dispose(); }
});

it('keeps each cue under 400ms except win and serializes judgment and claim playback', async () => {
  const { audio, oscillators } = fakeAudio();
  const { sound, activate, dispose } = await activateSound();
  try {
    activate({ isTrusted: true } as Event);
    const names = ['tick', 'time-up', 'correct', 'wrong', 'cell-claimed', 'win'] as const;
    for (const name of names) {
      audio.currentTime += 1;
      const first = oscillators.length;
      sound.playSounds('display', name);
      const length = Math.max(...oscillators.slice(first).map(note => Number(note.stop.mock.calls[0][0]))) - audio.currentTime;
      expect(length > 0.4).toBe(name === 'win');
      expect(length).toBeGreaterThan(0);
    }
    audio.currentTime += 1;
    const first = oscillators.length;
    sound.playSounds('host', 'correct', 'cell-claimed');
    expect(oscillators[first + 3].start.mock.calls[0][0]).toBeGreaterThan(oscillators[first + 2].stop.mock.calls[0][0]);
  } finally { dispose(); }
});

it('defaults to quiet for players and shares one persisted pressed mute preference', async () => {
  const sound = await soundModule();
  const { SoundToggle } = await import('../../src/design-system/SoundToggle');
  const { rerender } = render(<SoundToggle role="player" />);
  const mute = screen.getByRole('button', { name: 'كتم أصوات اللعبة' });
  expect(mute).toHaveAttribute('aria-pressed', 'true');
  rerender(<SoundToggle role="display" />);
  expect(mute).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(mute);
  expect(mute).toHaveAttribute('aria-pressed', 'true');
  expect(localStorage.getItem(sound.soundPreferenceKey)).toBe('off');
  expect(sound.soundEnabled('host')).toBe(false);
  vi.resetModules();
  expect((await soundModule()).soundEnabled('display')).toBe(false);
  fireEvent.click(mute);
  expect(mute).toHaveAttribute('aria-pressed', 'false');
  expect(sound.soundEnabled('player')).toBe(true);
});

it('plays the last five ticks and timeout once and does not replay expired hydration', async () => {
  const { audio, oscillators } = fakeAudio();
  const { activate, dispose } = await activateSound();
  const { useCountdownSound } = await import('../../src/features/ui/game-sound');
  try {
    activate({ isTrusted: true } as Event);
    const { rerender } = renderHook(({ clock, seconds }) => useCountdownSound('host', clock, seconds), {
      initialProps: { clock: 'question-one', seconds: 6 },
    });
    for (const seconds of [5, 5, 6, 5, 4, 3, 2, 1, 0, 0]) {
      audio.currentTime += 1;
      rerender({ clock: 'question-one', seconds });
    }
    expect(oscillators.map(note => note.frequency.setValueAtTime.mock.calls[0][0])).toEqual([
      740, 740, 740, 740, 740, 435, 295,
    ]);
    rerender({ clock: 'expired-on-arrival', seconds: 0 });
    expect(oscillators).toHaveLength(7);
  } finally { dispose(); }
});

it('plays time-up if the server retires a deadline before the client reaches zero', async () => {
  const { oscillators } = fakeAudio();
  const { activate, dispose } = await activateSound();
  const { useCountdownSound } = await import('../../src/features/ui/game-sound');
  try {
    activate({ isTrusted: true } as Event);
    const { rerender } = renderHook(({ key, seconds, now }: { key: string | null; seconds: number | null; now?: number }) =>
      useCountdownSound('display', key, seconds, key ? 1000 : undefined, now),
    { initialProps: { key: 'one', seconds: 1, now: 800 } });
    rerender({ key: null, seconds: null, now: 1100 });
    expect(oscillators.map(note => note.frequency.setValueAtTime.mock.calls[0][0])).toEqual([740, 435, 295]);
    rerender({ key: 'two', seconds: 1, now: 800 });
    rerender({ key: 'two', seconds: 0, now: 1000 });
    rerender({ key: null, seconds: null, now: 1100 });
    expect(oscillators.map(note => note.frequency.setValueAtTime.mock.calls[0][0])).toEqual([740, 435, 295, 740, 435, 295]);
    rerender({ key: 'three', seconds: 1, now: 800 });
    rerender({ key: null, seconds: null, now: 900 });
    expect(oscillators.map(note => note.frequency.setValueAtTime.mock.calls[0][0])).toEqual([740, 435, 295, 740, 435, 295, 740]);
  } finally { dispose(); }
});

it('uses the first and reconnect snapshots only as baselines for judgment cues', async () => {
  const { oscillators } = fakeAudio();
  const { activate, dispose } = await activateSound();
  const { useGameSoundTransition } = await import('../../src/features/ui/game-sound');
  const transition = () => ['correct' as const];
  try {
    activate({ isTrusted: true } as Event);
    const { rerender } = renderHook(({ revision }: { revision: number | null }) =>
      useGameSoundTransition('display', revision, transition),
    { initialProps: { revision: 2 } });
    expect(oscillators).toHaveLength(0);
    rerender({ revision: 3 });
    expect(oscillators).toHaveLength(3);
    rerender({ revision: null });
    rerender({ revision: 7 });
    expect(oscillators).toHaveLength(3);
  } finally { dispose(); }
});
