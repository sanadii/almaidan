import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { loadEpisodeCatalog } from './client';

const HasEpisodes = createContext(false);

export function EpisodeNavigation({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [hasEpisodes, setHasEpisodes] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void loadEpisodeCatalog(controller.signal).then(episodes => {
      if (!controller.signal.aborted) setHasEpisodes(episodes.length > 0);
    }, () => { /* The navigation stays hidden if the catalogue is unavailable. */ });
    return () => controller.abort();
  }, [enabled]);
  return <HasEpisodes.Provider value={enabled && hasEpisodes}>{children}</HasEpisodes.Provider>;
}

export function useHasEpisodes() {
  return useContext(HasEpisodes);
}
