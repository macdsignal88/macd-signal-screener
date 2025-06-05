import numpy as np
import pandas as pd
from typing import List, Dict, Any

class BatchMacdService:
    def __init__(self):
        self.fast_period = 24
        self.slow_period = 52
        self.signal_period = 9
        self.data = None

    def calculate_macd(self, prices: List[float], symbol: str, timeframe: str, dates: List[str]) -> Dict[str, List[float]]:
        prices_array = np.array(prices)
        fast_ema = self._calculate_ema(prices_array, self.fast_period)
        slow_ema = self._calculate_ema(prices_array, self.slow_period)
        macd_line = fast_ema - slow_ema
        signal_line = self._calculate_ema(macd_line, self.signal_period)
        macd_histogram = macd_line - signal_line
        return {
            "macd_line": macd_line.tolist(),
            "signal_line": signal_line.tolist(),
            "macd_histogram": macd_histogram.tolist()
        }

    def _calculate_ema(self, data: np.ndarray, period: int) -> np.ndarray:
        return pd.Series(data).ewm(span=period, adjust=False).mean().values

    def calculate_ema_midpoints(self, close_prices: List[float]) -> List[float]:
        return self._calculate_ema(np.array(close_prices), self.fast_period).tolist()
    def _trigger_signal(self, i, signal_number: int, condition: str, triggered: List[str]):
            self.data.at[i, f'signal_{signal_number}'] = True
            self.data.at[i, 'meta_condition'] = condition
            triggered.append(f'signal_{signal_number}')
            # Keep all previously triggered signals true
            if i > 0:
                for n in range(1, signal_number):
                    if self.data.at[i - 1, f'signal_{n}']:
                        self.data.at[i, f'signal_{n}'] = True

    def detect_signals(self, macd_data: Dict[str, List[float]], close_prices: List[float], ema_midpoints: List[float], dates: List[str]) -> pd.DataFrame:
        self.data = pd.DataFrame({
            'macd_line': macd_data['macd_line'],
            'signal_line': macd_data['signal_line'],
            'macd_histogram': macd_data['macd_histogram'],
            'close': close_prices,
            'ema_midpoint': ema_midpoints,
            'date': dates
        })

        for n in range(1, 6):
            self.data[f'signal_{n}'] = False

        self.data['meta_cycle_id'] = pd.NA
        self.data['meta_condition'] = pd.NA
        self.data['triggered_signals'] = None

        cycle_id = 0
        current_cycle_step = 0
        in_cycle = False
        post_signal5_counter = 0  # Count days after signal 5

        for i in range(10, len(self.data)):
            try:
                row, prev_row, prev2_row = self.data.iloc[i], self.data.iloc[i - 1], self.data.iloc[i - 2]
                macd, signal, hist = row['macd_line'], row['signal_line'], row['macd_histogram']
                prev_macd, prev_signal, prev_hist, prev2_hist = prev_row['macd_line'], prev_row['signal_line'], prev_row['macd_histogram'], prev2_row['macd_histogram']
                close, ema_mid = row['close'], float(row['ema_midpoint']) if pd.notna(row['ema_midpoint']) else None

                triggered = []

                # If in 3-day post-cycle hold, copy previous signal state
                if post_signal5_counter > 0:
                    # Allow restarting a cycle if signal_1 is detected
                    if macd < signal and macd > 0:
                        cycle_id += 1
                        in_cycle = True
                        current_cycle_step = 1
                        post_signal5_counter = 0  # Cancel the hold period
                        self._trigger_signal(i, 1, "Bearish MACD crossover above zero (new cycle during hold)", triggered)
                        self.data.at[i, 'meta_cycle_id'] = cycle_id
                        self.data.at[i, 'triggered_signals'] = triggered
                        continue  # Proceed to next row

                    # Otherwise, hold previous signals
                    for n in range(1, 6):
                        self.data.at[i, f'signal_{n}'] = True
                    self.data.at[i, 'meta_cycle_id'] = cycle_id
                    self.data.at[i, 'meta_condition'] = "Post signal_5 hold"
                    self.data.at[i, 'triggered_signals'] = ['hold_day_' + str(post_signal5_counter + 1)]
                    post_signal5_counter += 1
                    if post_signal5_counter >= 3:
                        post_signal5_counter = 0
                        in_cycle = False
                        current_cycle_step = 0
                    continue


                # Start new cycle with signal 1
                if macd < signal and macd > 0:
                    cycle_id += 1
                    in_cycle = True
                    current_cycle_step = 1
                    self._trigger_signal(i, 1, "Bearish MACD crossover above zero", triggered)
                    self.data.at[i, 'meta_cycle_id'] = cycle_id
                    self.data.at[i, 'triggered_signals'] = triggered
                    continue

                if in_cycle:
                    self.data.at[i, 'meta_cycle_id'] = cycle_id

                    # Propagate previous signals
                    for n in range(1, 6):
                        self.data.at[i, f'signal_{n}'] = self.data.at[i - 1, f'signal_{n}']

                    if current_cycle_step >= 1 and not self.data.at[i, 'signal_2']:
                        macd_peak_10 = max(self.data.iloc[i - 10:i]['macd_line'])
                        if macd < 0.4 * macd_peak_10:
                            self._trigger_signal(i, 2, "MACD drops 60% from recent 10-candle peak", triggered)
                            current_cycle_step = 2

                    if current_cycle_step >= 2 and not self.data.at[i, 'signal_3']:
                        if ema_mid is not None and close < ema_mid:
                            self._trigger_signal(i, 3, "Price below EMA midpoint", triggered)
                            current_cycle_step = 3

                    if current_cycle_step >= 3 and not self.data.at[i, 'signal_4']:
                        if abs(hist) < abs(prev_hist) < abs(prev2_hist):
                            self._trigger_signal(i, 4, "Histogram weakens for 3 consecutive bars", triggered)
                            current_cycle_step = 4

                    if current_cycle_step >= 4 and not self.data.at[i, 'signal_5']:
                        if macd > signal and prev_macd < prev_signal and macd > 0 and signal > 0:
                            self._trigger_signal(i, 5, "Bullish MACD crossover above zero (end)", triggered)
                            post_signal5_counter = 1  # Start post-signal_5 hold from next row
                            current_cycle_step = 5

                self.data.at[i, 'triggered_signals'] = triggered if triggered else None

            except Exception as e:
                print(f"Error processing index {i}: {e}")

        return self.data

    def calculate_signals(self, macd_data: Dict[str, List[float]], close_prices: List[float], ema_midpoints: List[float], symbol: str, timeframe: str, dates: List[str], asset_type: str) -> List[Dict[str, Any]]:
        self.detect_signals(macd_data, close_prices, ema_midpoints, dates)
        self.data['symbol'] = symbol
        self.data['timeframe'] = timeframe
        self.data['ema_mid'] = ema_midpoints
        self.data.rename(columns={'close': 'close_price'}, inplace=True)
        self.data['date'] = pd.to_datetime(self.data['date']).dt.strftime('%Y-%m-%d')

        selected_columns = [
            'symbol', 'timeframe', 'date', 'close_price', 'macd_line', 'signal_line',
            'macd_histogram', 'ema_mid', 'signal_1', 'signal_2', 'signal_3',
            'signal_4', 'signal_5', 'meta_cycle_id', 'meta_condition', 'triggered_signals'
        ]

        self.data['triggered_signals'] = self.data['triggered_signals'].apply(
            lambda x: ','.join(x) if isinstance(x, list) else None
        )

        signal_list = self.data[selected_columns].to_dict('records')
        for signal in signal_list:
            signal['asset_type'] = asset_type
        return signal_list