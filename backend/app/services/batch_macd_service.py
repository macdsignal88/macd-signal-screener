import numpy as np
import pandas as pd
from typing import List, Dict, Any, Tuple

class BatchMacdService:
    def __init__(self):
        self.fast_period = 24
        self.slow_period = 52
        self.signal_period = 9

        self.fast_macd = 12
        self.slow_macd = 26

    def calculate_macd(self, prices: List[float]) -> Dict[str, List[float]]:
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
        fast_ema = self._calculate_ema(prices_array, self.fast_period)
        slow_ema = self._calculate_ema(prices_array, self.slow_period)
        ema_midpoint = (fast_ema + slow_ema) / 2
        return ema_midpoint.tolist()

    def detect_signals(self, macd_data: Dict[str, List[float]], close_prices: List[float],
                    ema_midpoints: List[float], dates: List[str]) -> pd.DataFrame:
        data = pd.DataFrame({
            'macd_line': macd_data['macd_line'],
            'signal_line': macd_data['signal_line'],
            'macd_histogram': macd_data['macd_histogram'],
            'close': close_prices,
            'ema_midpoint': ema_midpoints,
            'date': dates
        })

        for n in range(1, 6):
            data[f'signal_{n}'] = False

        data['meta_cycle_id'] = pd.NA
        data['meta_condition'] = pd.NA
        data['triggered_signals'] = None

        cycle_id = 0
        in_cycle = False
        current_cycle_step = 0
        triggered_signals_in_cycle = set()  # New: Track triggered signals in this cycle

        for i in range(10, len(data)):
            try:
                row = data.iloc[i]
                prev_row = data.iloc[i - 1]
                prev2_row = data.iloc[i - 2]

                macd, signal, hist = row['macd_line'], row['signal_line'], row['macd_histogram']
                prev_macd, prev_signal = prev_row['macd_line'], prev_row['signal_line']
                prev_hist, prev2_hist = prev_row['macd_histogram'], prev2_row['macd_histogram']
                close, ema_mid = row['close'], float(row['ema_midpoint']) if pd.notna(row['ema_midpoint']) else None

                triggered = []

                # Reset cycle if signal_5 was triggered in the previous row
                if data.at[i - 1, 'signal_5']:
                    in_cycle = False
                    current_cycle_step = 0
                    triggered_signals_in_cycle.clear()
                    for n in range(1, 6):
                        data.at[i, f'signal_{n}'] = False
                    data.at[i, 'meta_condition'] = "Reset after signal_5"
                    continue

                # Start a new cycle if needed
                if not in_cycle and self._should_start_new_cycle(macd, signal):
                    cycle_id += 1
                    in_cycle = True
                    current_cycle_step = 1
                    triggered_signals_in_cycle = {1}
                    data, triggered = self._trigger_signal(data, i, 1, "Bearish MACD crossover above zero", triggered)
                    data.at[i, 'meta_cycle_id'] = cycle_id
                    data.at[i, 'triggered_signals'] = triggered
                    continue

                if in_cycle:
                    data.at[i, 'meta_cycle_id'] = cycle_id
                    data = self._propagate_signals(data, i, triggered_signals_in_cycle)

                    if 2 not in triggered_signals_in_cycle:
                        data, triggered, current_cycle_step = self._check_signal_2(data, i, macd, triggered, current_cycle_step)
                        if data.at[i, 'signal_2']:
                            triggered_signals_in_cycle.add(2)

                    if 3 not in triggered_signals_in_cycle:
                        data, triggered, current_cycle_step = self._check_signal_3(data, i, close, ema_mid, triggered, current_cycle_step)
                        if data.at[i, 'signal_3']:
                            triggered_signals_in_cycle.add(3)

                    if 4 not in triggered_signals_in_cycle:
                        data, triggered, current_cycle_step = self._check_signal_4(data, i, hist, prev_hist, prev2_hist, triggered, current_cycle_step)
                        if data.at[i, 'signal_4']:
                            triggered_signals_in_cycle.add(4)

                    if 5 not in triggered_signals_in_cycle:
                        data, triggered, in_cycle, current_cycle_step = self._check_signal_5(data, i, macd, signal, prev_macd, prev_signal, cycle_id, triggered, current_cycle_step)
                        if data.at[i, 'signal_5']:
                            triggered_signals_in_cycle.add(5)

                if triggered:
                    data.at[i, 'triggered_signals'] = triggered

            except Exception as e:
                print(f"Error processing index {i}: {e}")

        return data


    def _should_start_new_cycle(self, macd: float, signal: float) -> bool:
        return macd < signal and macd > 0 and signal > 0

    def _trigger_signal(self, data: pd.DataFrame, i: int, signal_number: int,
                        condition: str, triggered: List[str]) -> Tuple[pd.DataFrame, List[str]]:
        signal_col = f'signal_{signal_number}'
        data.at[i, signal_col] = True
        data.at[i, 'meta_condition'] = condition

        existing = data.at[i, 'triggered_signals']
        if isinstance(existing, list):
            if signal_col not in existing:
                existing.append(signal_col)
        else:
            existing = [signal_col]

        data.at[i, 'triggered_signals'] = existing
        return data, existing

    def _propagate_signals(self, data: pd.DataFrame, i: int, triggered_signals_in_cycle: set) -> pd.DataFrame:
        for n in triggered_signals_in_cycle:
            data.at[i, f'signal_{n}'] = True
        return data


    def _not_triggered(self, data: pd.DataFrame, i: int, signal_number: int) -> bool:
        return not data.at[i, f'signal_{signal_number}']

    def _check_signal_2(self, data, i, macd, triggered, step):
        macd_peak_10 = max(data.iloc[i - 10:i]['macd_line'])
        if macd < 0.4 * macd_peak_10:
            data, triggered = self._trigger_signal(data, i, 2, "MACD drops 60% from recent 10-candle peak", triggered)
            step = 2
        return data, triggered, step

    def _check_signal_3(self, data, i, close, ema_mid, triggered, step):
        if ema_mid is not None and close < ema_mid:
            data, triggered = self._trigger_signal(data, i, 3, "Price below EMA midpoint", triggered)
            step = 3
        return data, triggered, step

    def _check_signal_4(self, data, i, hist, prev_hist, prev2_hist, triggered, step):
        if abs(hist) < abs(prev_hist) < abs(prev2_hist):
            data, triggered = self._trigger_signal(data, i, 4, "Histogram weakens for 3 consecutive bars", triggered)
            step = 4
        return data, triggered, step

    def _check_signal_5(self, data, i, macd, signal, prev_macd, prev_signal, cycle_id, triggered, step):
        if macd > signal and prev_macd < prev_signal:
            if macd > 0 and signal > 0:
                data, triggered = self._trigger_signal(data, i, 5, "Bullish MACD crossover above zero (end)", triggered)
                step = 5
            else:
                data.at[i, 'meta_cycle_id'] = cycle_id
                data.at[i, 'meta_condition'] = "END CYCLE (bullish crossover below zero)"
                data.at[i, 'triggered_signals'] = ["END_CYCLE"]
                return data, triggered, False, 0
        return data, triggered, True, step

    def calculate_signals(self, macd_data: Dict[str, List[float]], close_prices: List[float],
                          ema_midpoints: List[float], symbol: str, timeframe: str,
                          dates: List[str], asset_type: str) -> List[Dict[str, Any]]:
        self.data = self.detect_signals(macd_data, close_prices, ema_midpoints, dates)
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
