import React, { createContext, useContext, useEffect, useState } from 'react';
import { SignalDisplayConfig, TimeFrame } from '@/lib/types';

// Storage keys
const STORAGE_KEYS = {
  SELECTED_TIMEFRAMES: 'macd-screener-timeframes',
  MACD_DAYS: 'macd-screener-macd-days',
  PRICE_CHART_DAYS: 'macd-screener-price-chart-days',
  SIGNAL_CONFIG: 'macd-screener-signal-config'
};

// Default values
const DEFAULT_MACD_DAYS = 7;
const DEFAULT_PRICE_CHART_DAYS = 30;
const DEFAULT_SIGNAL_CONFIG: SignalDisplayConfig[] = [
  {
    type: 'SIGNAL_1',
    label: 'Signal 1',
    description: 'Signal line crosses over MACD line while both are above zero',
    enabled: true,
  },
  {
    type: 'SIGNAL_2',
    label: 'Signal 2',
    description: 'MACD line drops 60% or more from its last peak point',
    enabled: true,
  },
  {
    type: 'SIGNAL_3',
    label: 'Signal 3',
    description: 'MACD line forms a 45-degree or steeper downtrend',
    enabled: true,
  },
  {
    type: 'SIGNAL_4',
    label: 'Signal 4',
    description: 'Close price reaches the midpoint between EMA52 and EMA24',
    enabled: true,
  },
  {
    type: 'SIGNAL_5',
    label: 'Signal 5',
    description: 'Histogram below zero turns white for 2 consecutive bars',
    enabled: true,
  },
  {
    type: 'SIGNAL_6',
    label: 'Signal 6',
    description: 'MACD line turns upward, making a higher point than the previous',
    enabled: true,
  }
];

interface SettingsContextType {
  selectedTimeframes: TimeFrame[];
  macdDays: number;
  priceChartDays: number;
  signalConfig: SignalDisplayConfig[];
  setSelectedTimeframes: (timeframes: TimeFrame[]) => void;
  setMacdDays: (days: number) => void;
  setPriceChartDays: (days: number) => void;
  setSignalConfig: (config: SignalDisplayConfig[]) => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [selectedTimeframes, setSelectedTimeframes] = useState<TimeFrame[]>(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.SELECTED_TIMEFRAMES);
    return stored ? JSON.parse(stored) : ['1d', '1wk', '1mo', '3mo', '2d', '3d', '5d', '2wk', '2mo', '3mo', '4mo', '5mo'];
  });

  const [macdDays, setMacdDays] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.MACD_DAYS);
    return stored ? parseInt(stored, 10) : DEFAULT_MACD_DAYS;
  });

  const [priceChartDays, setPriceChartDays] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.PRICE_CHART_DAYS);
    return stored ? parseInt(stored, 10) : DEFAULT_PRICE_CHART_DAYS;
  });

  const [signalConfig, setSignalConfig] = useState<SignalDisplayConfig[]>(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.SIGNAL_CONFIG);
    if (stored) {
      try {
        return JSON.parse(stored);
      } catch {
        console.warn("Invalid localStorage data. Resetting...");
      }
    }
    return DEFAULT_SIGNAL_CONFIG;
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
    localStorage.setItem(STORAGE_KEYS.SIGNAL_CONFIG, JSON.stringify(signalConfig));
  }, [signalConfig]);

  return (
    <SettingsContext.Provider
      value={{
        selectedTimeframes,
        macdDays,
        priceChartDays,
        signalConfig,
        setSelectedTimeframes,
        setMacdDays,
        setPriceChartDays,
        setSignalConfig,
      }}
    >
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