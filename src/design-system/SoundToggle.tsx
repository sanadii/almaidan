import { useSyncExternalStore } from 'react';
import { setSoundEnabled, soundEnabled, subscribeSoundPreference, type SoundRole } from '../lib/sound';
import { Icon } from './Icon';
import { ThemeToggle } from './ThemeToggle';
import './sound-toggle.css';

export function SoundToggle({ role }: { role: SoundRole }) {
  const enabled = useSyncExternalStore(subscribeSoundPreference, () => soundEnabled(role), () => false);
  return <button aria-label="كتم أصوات اللعبة" aria-pressed={!enabled} className="sound-toggle"
    title={enabled ? 'اكتم الصوت' : 'شغّل الصوت'} onClick={() => setSoundEnabled(!enabled)} type="button">
    <Icon kind={enabled ? 'sound' : 'sound-off'} />
  </button>;
}

export function GameplayPreferences({ role }: { role: SoundRole }) {
  return <div className="gameplay-preferences"><ThemeToggle compact iconOnly /><SoundToggle role={role} /></div>;
}
