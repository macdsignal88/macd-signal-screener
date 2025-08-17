import asyncio
import json
import logging
import sys
import os
from datetime import datetime, timedelta
import pytz
import aiohttp

from app.services.batch_signal_processor import batch_signal_processor

# Setup logger
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger(__name__)

# Read symbols from JSON
script_dir = os.path.dirname(os.path.abspath(__file__))
file_path = os.path.join(script_dir, "..", "..", "symbols_yf.json")

with open(file_path, "r") as f:
    data = json.load(f)

symbols = []
asset_types = {}
for category, symbol_list in data.items():
    for symbol in symbol_list:
        symbols.append(symbol)
        asset_types[symbol] = category

# Update intervals
UPDATE_SCHEDULES = {
    '1d': {'interval': '1d', 'period': '6mo', 'schedule': 'daily'},
    '2d': {'interval': '2d', 'period': '6mo', 'schedule': 'daily'},
    '3d': {'interval': '3d', 'period': '6mo', 'schedule': 'daily'},
    '5d': {'interval': '5d', 'period': '6mo', 'schedule': 'daily'},
    '1wk': {'interval': '1wk', 'period': '6mo', 'schedule': 'weekly'},
    '2wk': {'interval': '2wk', 'period': '6mo', 'schedule': 'weekly'},
    '3wk': {'interval': '3wk', 'period': '6mo', 'schedule': 'weekly'},
    '1mo': {'interval': '1mo', 'period': '6mo', 'schedule': 'monthly'},
    '2mo': {'interval': '2mo', 'period': '6mo', 'schedule': 'monthly'},
    '3mo': {'interval': '3mo', 'period': '6mo', 'schedule': 'monthly'},
    '4mo': {'interval': '4mo', 'period': '6mo', 'schedule': 'monthly'},
    '5mo': {'interval': '5mo', 'period': '6mo', 'schedule': 'monthly'},
}

def is_last_day_of_month(today):
    return (today + timedelta(days=1)).month != today.month

def should_run_today(config, today):
    schedule_type = config['schedule']
    if schedule_type == 'daily':
        return True
    elif schedule_type == 'weekly':
        return today.weekday() == 4  # Friday
    elif schedule_type == 'monthly':
        return is_last_day_of_month(today)
    return False

async def fetch_with_retry(symbol, interval_config, session, semaphore):
    retries = 3
    delay = 1

    for attempt in range(retries):
        async with semaphore:
            try:
                # Create a single-symbol list and use process_symbols
                result = await batch_signal_processor.process_symbols(
                    symbols=[symbol],
                    period=interval_config['period'],
                    interval=interval_config['interval'],
                    asset_types={symbol: asset_types.get(symbol, 'unknown')}
                )
                return symbol, result
            except Exception as e:
                logger.warning(f"[{interval_config['interval']}] Retry {attempt + 1} failed for {symbol}: {e}")
                await asyncio.sleep(delay)
                delay *= 2

    logger.error(f"[{interval_config['interval']}] All retries failed for {symbol}")
    return symbol, []

async def process_interval(interval_config):
    logger.info(f"Processing interval: {interval_config['interval']}")
    failed_symbols = {}

    # Create semaphore in the same event loop context
    semaphore = asyncio.Semaphore(10)  # Throttle concurrency to 10

    async with aiohttp.ClientSession() as session:
        tasks = [fetch_with_retry(symbol, interval_config, session, semaphore) for symbol in symbols]
        results = await asyncio.gather(*tasks)

    signals_by_symbol = {}
    for symbol, signals in results:
        if signals:
            signals_by_symbol[symbol] = signals
        else:
            failed_symbols[symbol] = True

    for symbol in symbols:
        count = len(signals_by_symbol.get(symbol, []))
        logger.info(f"[{interval_config['interval']}] {symbol}: {count} signals")

    # Write failed symbols to log file
    if failed_symbols:
        fail_path = os.path.join(script_dir, f"failed_{interval_config['interval']}.log")
        with open(fail_path, "w") as f:
            for sym in failed_symbols:
                f.write(sym + "\n")
        logger.warning(f"{len(failed_symbols)} symbols failed. Logged to {fail_path}")

def main():
    current_time = datetime.now(pytz.timezone("UTC"))
    logger.info("Scheduled update started")

    for config in UPDATE_SCHEDULES.values():
        if should_run_today(config, current_time):
            asyncio.run(process_interval(config))

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        logger.exception(f"Unhandled exception in script: {e}")
        sys.exit(1)
