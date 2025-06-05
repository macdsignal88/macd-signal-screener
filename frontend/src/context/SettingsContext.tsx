import React, { createContext, useContext, useEffect, useState } from 'react';
import { SignalDisplayConfig, TimeFrame } from '@/lib/types';

// Storage keys
const STORAGE_KEYS = {
  SELECTED_TIMEFRAMES: 'macd-screener-timeframes',
  MACD_DAYS: 'macd-screener-macd-days',
  PRICE_CHART_DAYS: 'macd-screener-price-chart-days',
  SIGNAL_CONFIG: 'macd-screener-signal-config',
  ROWS_PER_PAGE: 'macd-screener-rows-per-page',
  SIGNAL_PERSISTENCE_DAYS: 'macd-screener-signal-persistence-days'
};

// Default values
const DEFAULT_MACD_DAYS = 7;
const DEFAULT_PRICE_CHART_DAYS = 30;
const DEFAULT_ROWS_PER_PAGE = 50;
const DEFAULT_SIGNAL_PERSISTENCE_DAYS = 3;
const DEFAULT_SIGNAL_CONFIG: SignalDisplayConfig[] = [
  {
    type: 'SIGNAL_1',
    label: 'Signal 1',
    description: 'Bearish MACD crossover above zero',
    enabled: true,
  },
  {
    type: 'SIGNAL_2',
    label: 'Signal 2',
    description: 'MACD drops 60% from peak',
    enabled: true,
  },
  {
    type: 'SIGNAL_3',
    label: 'Signal 3',
    description: 'Price below EMA midpoint',
    enabled: true,
  },
  {
    type: 'SIGNAL_4',
    label: 'Signal 4',
    description: 'Histogram weakens for 3 consecutive bars',
    enabled: true,
  },
  {
    type: 'SIGNAL_5',
    label: 'Signal 5',
    description: 'Bullish MACD crossover',
    enabled: true,
  }
];

export interface SettingsContextType {
  selectedTimeframes: TimeFrame[];
  macdDays: number;
  priceChartDays: number;
  enabledSignals: SignalDisplayConfig[];
  signalPersistenceDays: number;
  setSelectedTimeframes: (value: TimeFrame[]) => void;
  setMacdDays: (value: number) => void;
  setPriceChartDays: (value: number) => void;
  setEnabledSignals: (value: SignalDisplayConfig[]) => void;
  setSignalPersistenceDays: (value: number) => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [selectedTimeframes, setSelectedTimeframes] = useState<TimeFrame[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.SELECTED_TIMEFRAMES);
    return saved ? JSON.parse(saved) : ['1d', '1wk', '1mo', '3mo', '2d', '3d', '5d', '2wk', '2mo', '3mo', '4mo', '5mo'];
  });

  const [macdDays, setMacdDays] = useState<number>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.MACD_DAYS);
    return saved ? parseInt(saved) : DEFAULT_MACD_DAYS;
  });

  const [priceChartDays, setPriceChartDays] = useState<number>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.PRICE_CHART_DAYS);
    return saved ? parseInt(saved) : DEFAULT_PRICE_CHART_DAYS;
  });

  const [enabledSignals, setEnabledSignals] = useState<SignalDisplayConfig[]>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.SIGNAL_CONFIG);
    return saved ? JSON.parse(saved) : DEFAULT_SIGNAL_CONFIG;
  });

  const [signalPersistenceDays, setSignalPersistenceDays] = useState<number>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.SIGNAL_PERSISTENCE_DAYS);
    return saved ? parseInt(saved) : DEFAULT_SIGNAL_PERSISTENCE_DAYS;
  });

  // Save to localStorage whenever settings change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.SELECTED_TIMEFRAMES, JSON.stringify(selectedTimeframes));
  }, [selectedTimeframes]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.MACD_DAYS, macdDays.toString());
  }, [macdDays]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.PRICE_CHART_DAYS, priceChartDays.toString());
  }, [priceChartDays]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.SIGNAL_CONFIG, JSON.stringify(enabledSignals));
  }, [enabledSignals]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.SIGNAL_PERSISTENCE_DAYS, signalPersistenceDays.toString());
  }, [signalPersistenceDays]);

  const value = {
    selectedTimeframes,
    macdDays,
    priceChartDays,
    enabledSignals,
    signalPersistenceDays,
    setSelectedTimeframes,
    setMacdDays,
    setPriceChartDays,
    setEnabledSignals,
    setSignalPersistenceDays,
  };

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}; 