import numpy as np
import pandas as pd
import time
from typing import List, Dict, Any

class BatchMacdService:
    def __init__(self):
        self.fast_period = 12
        self.slow_period = 26
        self.signal_period = 9
        self.data = None  # Initialize self.data as None until data is passed

    def calculate_macd(self, prices: List[float], symbol: str, timeframe: str, dates: List[str]) -> Dict[str, List[float]]:
        """Calculate MACD, Signal line, and Histogram"""
        # Convert to numpy array for calculations
        prices_array = np.array(prices)
        
        # Calculate EMAs
        fast_ema = self._calculate_ema(prices_array, self.fast_period)
        slow_ema = self._calculate_ema(prices_array, self.slow_period)
        
        # Calculate MACD line
        macd_line = fast_ema - slow_ema
        
        # Calculate Signal line
        signal_line = self._calculate_ema(macd_line, self.signal_period)
        
        # Calculate Histogram
        macd_histogram = macd_line - signal_line
        
        return {
            "macd_line": macd_line.tolist(),
            "signal_line": signal_line.tolist(),
            "macd_histogram": macd_histogram.tolist()
        }

    def _calculate_ema(self, data: np.ndarray, period: int) -> np.ndarray:
        """Calculate Exponential Moving Average"""
        result = pd.Series(data).ewm(span=period, adjust=False).mean().values
        return result


    def detect_signals(self, macd_data: Dict[str, List[float]], close_prices: List[float], ema_midpoints: List[float], dates) -> pd.DataFrame:
        """Detect MACD signals from the data."""

        # Initialize DataFrame
        self.data = pd.DataFrame({
            'macd_line': macd_data['macd_line'],
            'signal_line': macd_data['signal_line'],
            'macd_histogram': macd_data['macd_histogram'],
            'close': close_prices,
            'ema_midpoint': ema_midpoints,
            'date': dates
        })

        # Initialize signal columns and metadata
        for n in range(1, 8):
            self.data[f'signal_{n}'] = False
        self.data['meta_cycle_id'] = pd.NA
        self.data['meta_condition'] = pd.NA
        self.data['triggered_signals'] = None

        current_cycle_step = 0
        cycle_id = 0
        cycle_memory = {f'signal_{n}': False for n in range(1, 8)}

        for i in range(2, len(self.data)):
            try:
                row = self.data.iloc[i]
                prev_row = self.data.iloc[i - 1]
                prev2_row = self.data.iloc[i - 2]

                macd, signal, hist = row['macd_line'], row['signal_line'], row['macd_histogram']
                prev_macd, prev_signal, prev_hist = prev_row['macd_line'], prev_row['signal_line'], prev_row['macd_histogram']
                prev2_macd, prev2_hist = prev2_row['macd_line'], prev2_row['macd_histogram']

                close, ema_mid = row['close'], row['ema_midpoint']
                ema_mid = float(ema_mid) if pd.notna(ema_mid) else None

                # Save current state before possible changes
                prev_cycle_memory = cycle_memory.copy()
                triggered = []

                def trigger_signal(n: int, condition: str):
                    nonlocal triggered
                    key = f'signal_{n}'
                    cycle_memory[key] = True
                    self.data.at[i, key] = True
                    self.data.at[i, 'meta_condition'] = condition
                    triggered.append(key)

                # Start of a new bearish MACD crossover cycle
                if (prev_macd > prev_signal) and (macd < signal) and (macd > 0):
                    cycle_id += 1
                    current_cycle_step = 1
                    cycle_memory = {f'signal_{n}': False for n in range(1, 8)}
                    trigger_signal(1, "Bearish MACD crossover above zero")
                    self.data.at[i, 'meta_cycle_id'] = cycle_id
                    self.data.at[i, 'triggered_signals'] = triggered
                    continue

                # Continue cycle progression
                if current_cycle_step >= 1:
                    self.data.at[i, 'meta_cycle_id'] = cycle_id

                    if current_cycle_step == 1 and macd < 0.4 * max(prev_macd, macd):
                        trigger_signal(2, "MACD dropped 60% from previous peak")
                        current_cycle_step = 2

                    if current_cycle_step == 2 and (macd - prev_macd) <= -0.1:
                        trigger_signal(3, "MACD steeply downward")
                        current_cycle_step = 3

                    if current_cycle_step == 3 and ema_mid is not None and close < ema_mid:
                        trigger_signal(4, "Close below EMA midpoint")
                        current_cycle_step = 4

                    if current_cycle_step == 4 and hist < prev_hist < prev2_hist:
                        trigger_signal(5, "Histogram weakening 3 bars")
                        current_cycle_step = 5

                    if current_cycle_step == 5 and macd > prev_macd and prev_macd < prev2_macd:
                        trigger_signal(6, "MACD upward reversal")
                        current_cycle_step = 6

                    if current_cycle_step == 6 and (prev_macd < prev_signal) and (macd > signal):
                        trigger_signal(7, "Bullish MACD crossover")
                        current_cycle_step = 0
                        # Reset signals after bullish crossover
                        for n in range(1, 7):
                            cycle_memory[f'signal_{n}'] = False

                # Detect newly triggered signals (post-initialization)
                for n in range(1, 8):
                    key = f'signal_{n}'
                    if cycle_memory[key] and not prev_cycle_memory[key] and key not in triggered:
                        triggered.append(key)

                self.data.at[i, 'triggered_signals'] = triggered if triggered else None

            except Exception as e:
                print(f"Error processing index {i}: {e}")

        return self.data



    def calculate_signals(
        self,
        macd_data: Dict[str, List[float]],
        close_prices: List[float],
        ema_midpoints: List[float],
        symbol: str,
        timeframe: str,
        dates: List[str],
        asset_type: str
    ) -> List[Dict[str, Any]]:

        self.detect_signals(macd_data, close_prices, ema_midpoints, dates)
        self.data['symbol'] = symbol
        self.data['timeframe'] = timeframe
        self.data['ema_mid'] = ema_midpoints

        # Rename close column to close_price
        self.data.rename(columns={'close': 'close_price'}, inplace=True)

        # Step 2: Format date column
        self.data['date'] = pd.to_datetime(self.data['date']).dt.strftime('%Y-%m-%d')

        # Step 3: Select and enrich signal data
        selected_columns = [
            'symbol', 'timeframe', 'date', 'close_price', 
            'macd_line', 'signal_line', 'macd_histogram','ema_mid',
            'signal_1', 'signal_2', 'signal_3', 'signal_4', 
            'signal_5', 'signal_6', 'signal_7', 
            'meta_cycle_id', 'meta_condition', 'triggered_signals'
        ]
        signal_list = self.data[selected_columns].to_dict('records')
        for signal in signal_list:
            signal['asset_type'] = asset_type
        self.data['triggered_signals'] = self.data['triggered_signals'].apply(lambda x: ','.join(x) if isinstance(x, list) else None)


        return signal_list


    def calculate_ema_midpoints(self, close_prices: List[float]) -> List[float]:
        """Calculate EMA midpoints for close prices"""
        
        ema_midpoints = self._calculate_ema(np.array(close_prices), self.fast_period).tolist()
        
        return ema_midpoints
