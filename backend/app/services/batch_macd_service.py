import numpy as np
import pandas as pd
from typing import List, Dict, Any

class BatchMacdService:
    def __init__(self):
        self.fast_period = 24
        self.slow_period = 52
        self.signal_period = 9

        self.fast_macd = 12
        self.slow_macd = 26

        self.data = None
        self.in_cycle = False
        self.current_cycle_step = 0


    def calculate_macd(self, prices: List[float], symbol: str, timeframe: str, dates: List[str]) -> Dict[str, List[float]]:
        prices_array = np.array(prices)
        fast_ema = self._calculate_ema(prices_array, self.fast_macd)
        slow_ema = self._calculate_ema(prices_array, self.slow_macd)
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
        prices_array = np.array(close_prices)
        fast_ema = self._calculate_ema(prices_array, self.fast_period)  # 24
        slow_ema = self._calculate_ema(prices_array, self.slow_period)  # 52
        ema_midpoint = (fast_ema + slow_ema) / 2
        return ema_midpoint.tolist()


    def _trigger_signal(self, i: int, signal_number: int, condition: str, triggered: List[str]):
        for n in range(1, signal_number + 1):
            self.data.at[i, f'signal_{n}'] = True
        self.data.at[i, 'meta_condition'] = condition
        triggered.append(f'signal_{signal_number}')

    def _propagate_signals(self, i: int):
        for n in range(1, 6):
            if self.data.at[i - 1, f'signal_{n}']:
                self.data.at[i, f'signal_{n}'] = True
            else:
                break

    def _reset_cycle(self):
        self.in_cycle = False
        self.current_cycle_step = 0

    def _handle_post_signal5_hold(self, i: int, cycle_id: int, post_counter: int) -> int:
        for n in range(1, 6):
            self.data.at[i, f'signal_{n}'] = True
        self.data.at[i, 'meta_cycle_id'] = cycle_id
        self.data.at[i, 'meta_condition'] = "Post signal_5 hold"
        self.data.at[i, 'triggered_signals'] = [f'hold_day_{post_counter + 1}']
        return post_counter + 1

    def _should_start_new_cycle(self, macd, signal):
        return macd < signal and macd > 0

    def _check_signal_2(self, i, macd, triggered):
        macd_peak_10 = max(self.data.iloc[i - 10:i]['macd_line'])
        if macd < 0.4 * macd_peak_10:
            self._trigger_signal(i, 2, "MACD drops 60% from recent 10-candle peak", triggered)
            self.current_cycle_step = 2

    def _check_signal_3(self, i, close, ema_mid, triggered):
        if ema_mid is not None and close < ema_mid:
            self._trigger_signal(i, 3, "Price below EMA midpoint", triggered)
            self.current_cycle_step = 3

    def _check_signal_4(self, i, hist, prev_hist, prev2_hist, triggered):
        if abs(hist) < abs(prev_hist) < abs(prev2_hist):
            self._trigger_signal(i, 4, "Histogram weakens for 3 consecutive bars", triggered)
            self.current_cycle_step = 4

    def _check_signal_5(self, i, macd, signal, prev_macd, prev_signal, cycle_id, triggered):
        if macd > signal and prev_macd < prev_signal:
            if macd > 0 and signal > 0:
                self._trigger_signal(i, 5, "Bullish MACD crossover above zero (end)", triggered)
                self.current_cycle_step = 5
                return 1  # post_signal5_counter = 1
            else:
                self._reset_cycle()
                self.data.at[i, 'meta_cycle_id'] = cycle_id
                self.data.at[i, 'meta_condition'] = "END CYCLE (bullish crossover below zero)"
                self.data.at[i, 'triggered_signals'] = ["END_CYCLE"]
        return 0

    def detect_signals(self, macd_data, close_prices, ema_midpoints, dates) -> pd.DataFrame:
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
        post_signal5_counter = 0

        for i in range(10, len(self.data)):
            try:
                row, prev_row, prev2_row = self.data.iloc[i], self.data.iloc[i - 1], self.data.iloc[i - 2]
                macd, signal, hist = row['macd_line'], row['signal_line'], row['macd_histogram']
                prev_macd, prev_signal = prev_row['macd_line'], prev_row['signal_line']
                prev_hist, prev2_hist = prev_row['macd_histogram'], prev2_row['macd_histogram']
                close, ema_mid = row['close'], float(row['ema_midpoint']) if pd.notna(row['ema_midpoint']) else None

                triggered = []

                if post_signal5_counter > 0:
                    if self._should_start_new_cycle(macd, signal):
                        cycle_id += 1
                        self.in_cycle = True
                        self.current_cycle_step = 1
                        post_signal5_counter = 0
                        self._trigger_signal(i, 1, "Bearish MACD crossover above zero (new cycle during hold)", triggered)
                        self.data.at[i, 'meta_cycle_id'] = cycle_id
                        self.data.at[i, 'triggered_signals'] = triggered
                        continue
                    post_signal5_counter = self._handle_post_signal5_hold(i, cycle_id, post_signal5_counter)
                    if post_signal5_counter >= 3:
                        post_signal5_counter = 0
                        self._reset_cycle()
                    continue

                if not self.in_cycle and self._should_start_new_cycle(macd, signal):
                    cycle_id += 1
                    self.in_cycle = True
                    self.current_cycle_step = 1
                    self._trigger_signal(i, 1, "Bearish MACD crossover above zero", triggered)
                    self.data.at[i, 'meta_cycle_id'] = cycle_id
                    self.data.at[i, 'triggered_signals'] = triggered
                    continue

                if self.in_cycle:
                    self.data.at[i, 'meta_cycle_id'] = cycle_id
                    self._propagate_signals(i)
                    if self.current_cycle_step >= 1 and not self.data.at[i, 'signal_2']:
                        self._check_signal_2(i, macd, triggered)
                    if self.current_cycle_step >= 2 and not self.data.at[i, 'signal_3']:
                        self._check_signal_3(i, close, ema_mid, triggered)
                    if self.current_cycle_step >= 3 and not self.data.at[i, 'signal_4']:
                        self._check_signal_4(i, hist, prev_hist, prev2_hist, triggered)
                    if self.current_cycle_step >= 4 and not self.data.at[i, 'signal_5']:
                        post_signal5_counter = self._check_signal_5(i, macd, signal, prev_macd, prev_signal, cycle_id, triggered)

                if triggered:
                    self.data.at[i, 'triggered_signals'] = triggered

            except Exception as e:
                print(f"Error processing index {i}: {e}")

        for i in range(len(self.data)):
            for n in range(2, 6):
                if self.data.at[i, f'signal_{n}']:
                    for k in range(1, n):
                        self.data.at[i, f'signal_{k}'] = True

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