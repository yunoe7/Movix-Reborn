import React, { createContext, useContext } from 'react';

export interface MiniPlayerContextValue {
  isMinimized?: boolean;
  videoSrc?: string | null;
  videoTitle?: string | null;
  videoType?: string | null;
  videoId?: string | number | null;
  seasonNumber?: number | null;
  episodeNumber?: number | null;
  currentTime?: number;
  duration?: number;
  isPlaying?: boolean;
  volume?: number;
  poster?: string | null;
  disableMiniPlayer?: () => void;
  updateCurrentTime?: (time: number) => void;
  updateDuration?: (duration: number) => void;
  updatePlayingState?: (playing: boolean) => void;
  updateVolume?: (volume: number) => void;
  returnToPlayer?: () => void;
}

const MiniPlayerContext = createContext<MiniPlayerContextValue>({});

export const MiniPlayerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return <MiniPlayerContext.Provider value={{}}>{children}</MiniPlayerContext.Provider>;
};

export const useMiniPlayer = (): MiniPlayerContextValue => useContext(MiniPlayerContext);