import { MacdData, MacdHistoryEntry, MacdHistoryItem, MacdSignal, PriceData, SignalDisplayConfig, SignalFlags, SingleStockWithMacdHistory, Stock, StockSignalResponse, StockSignals, StockWithMacdHistory, TimeFrame, TriggeredSignalRecord } from './types';

import mappingDirectory from '../lib/mapping_directory.json';
import { supabase } from './supabaseAuth';

// Remove duplicate client initialization
// const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
// const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// if (!supabaseUrl || !supabaseKey) {
//   throw new Error('Missing Supabase environment variables');
// }

// const supabase = createClient(supabaseUrl, supabaseKey);

const calculatePriceChange = (priceHistory: PriceData[]): number => {
  if (priceHistory.length < 2) return 0;
  const latestPrice = priceHistory[priceHistory.length - 1].price;
  const previousPrice = priceHistory[priceHistory.length - 2].price;
  return ((latestPrice - previousPrice) / previousPrice) * 100;
};

export const getLatestCreatedAt = async (): Promise<Date | null> => {
  const { data, error } = await supabase
    .from("macd_signals")
    .select("created_at")
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error("Error fetching latest created_at:", error);
    return null;
  }

  return data?.[0]?.created_at ? new Date(data[0].created_at) : null;
};



export const fetchStocksFromSupabase = async (): Promise<StockWithMacdHistory[]> => {
  try {
    const { data: signals, error } = await supabase
      .from('macd_signals')
      .select('*')
      .order('date', { ascending: false });

    if (error) throw error;
    if (!signals) return [];

    const stocksBySymbol = new Map<string, StockWithMacdHistory>();

    for (const signal of signals as MacdSignal[]) {
      const { symbol, date, close_price, timeframe } = signal;

      if (!stocksBySymbol.has(symbol)) {
        stocksBySymbol.set(symbol, {
          symbol,
          name: symbol,
          price: close_price,
          change: 0,
          macdHistory: [],
          priceHistory: [],
          signals: {}, // grouped by timeframe
        });
      }

      const stock = stocksBySymbol.get(symbol)!;

      // Default to using 1D data for macdHistory and priceHistory
      if (timeframe === '1D') {
        stock.macdHistory.push({
          date,
          macdLine: signal.macd_line,
          signalLine: signal.signal_line,
          histogram: signal.macd_histogram
        });

        stock.priceHistory.push({
          date,
          price: close_price
        });
      }

      // Initialize signals for this timeframe if not yet present
      if (!stock.signals[timeframe]) {
        stock.signals[timeframe] = [];
      }

      stock.signals[timeframe].push({
        date,
        signal_1: signal.signal_1,
        signal_2: signal.signal_2,
        signal_3: signal.signal_3,
        signal_4: signal.signal_4,
        signal_5: signal.signal_5,
        signal_6: signal.signal_6,
        signal_7: signal.signal_7
      });
    }

    const result: StockWithMacdHistory[] = [];

    for (const stock of stocksBySymbol.values()) {
      // Compute price change based on 1D price history
      stock.change = calculatePriceChange(stock.priceHistory);

      // Compute signal stats per timeframe
      for (const timeframe in stock.signals) {
        const signalArray = stock.signals[timeframe];
        stock.signalCounts[timeframe] = signalArray.length;

        stock.totalPositiveSignals[timeframe] = signalArray.reduce((sum, s) => {
          const positives =
            Number(s.signal_1) + Number(s.signal_2) + Number(s.signal_3) +
            Number(s.signal_4) + Number(s.signal_5) + Number(s.signal_6) +
            Number(s.signal_7);
          return sum + positives;
        }, 0);
      }

      result.push(stock);
    }

    return result;
  } catch (error) {
    console.error('Error fetching stocks from Supabase:', error);
    throw error;
  }
};


export type SignalTriggered = {
  date: string;
  triggeredSignals: string[]; // e.g. ['signal_1', 'signal_4']
};


// Types
type SortConfig = { field: string; direction: 'asc' | 'desc' };
type GroupedData = Record<string, {
  timeframes: Record<string, MacdSignal>;
  allHistory: MacdSignal[];
}>;

// 1. Count matching symbols
const getSymbolCount = async (assetType?: string, searchQuery?: string) => {
  let query = supabase.from('macd_signals').select('symbol', { count: 'exact' });
  if (assetType) query = query.eq('asset_type', assetType);
  if (searchQuery) query = query.ilike('symbol', `%${searchQuery}%`);
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
};

// 2. Fetch unique symbol count
const getUniqueSymbolCount = async () => {
  const { data, error } = await supabase.rpc('get_unique_symbol_count');
  if (error) throw error;
  return data ?? 0;
};

// 3. Fetch latest daily signals
const getLatestSignals = async (assetType?: string, searchQuery?: string) => {
  let query = supabase
    .from('macd_signals')
    .select('*')
    .order('date', { ascending: false });

  if (assetType) query = query.eq('asset_type', assetType);
  if (searchQuery) {
    query = query.ilike('symbol', `%${searchQuery}%`);
  }
  
  const { data, error } = await query;
  if (error) throw error;
  return data;
};

const getSingleSignal = async (symbol: string, searchQuery?: string) => {
  let query =supabase
  .from('macd_signals')
  .select('*')
  .eq('symbol', symbol)
  .order('date', { ascending: false });

  if (searchQuery) {
    query = query.or(`symbol.ilike.%${searchQuery}%,name.ilike.%${searchQuery}%`);
  }
  
  const { data, error } = await query;
  if (error) throw error;
  return data;
};


export const getWatchlistSignals = async (
  symbols: string[],
  assetType?: string,
  searchQuery?: string
): Promise<MacdSignal[]> => {
  if (!symbols.length) return [];

  const { data, error } = await supabase
    .from('macd_signals')
    .select('*')
    .in('symbol', symbols)
    .order('date', { ascending: false });

  if (error) {
    console.error('Error fetching watchlist signals:', error);
    throw error;
  }

  return data ?? [];
};

// 4. Calculate and sort symbols by signal count
const getSortedSymbolsBySignal = async (
  field: string,
  direction: 'asc' | 'desc',
  assetType?: string,
  searchQuery?: string
) => {
  const timeframe = field.toLowerCase();

  const { data, error } = await supabase.rpc('get_latest_signals_sorted', {
    timeframe_param: timeframe,
    asset_type_param: assetType || null,
    search_query_param: searchQuery || null,
    sort_direction: direction,
  });

  if (error) throw error;

  const signalCounts = new Map<string, number>();
  for (const row of data) {
    signalCounts.set(row.symbol, row.true_signal_count || 0);
  }

  const sortedSymbols = Array.from(signalCounts.keys());
  return { sortedSymbols, signalCounts };
};


// 5. Paginate symbols
const paginateSymbols = (symbols: string[], page: number, pageSize: number) => {
  const start = Math.max(0, page * pageSize);
  return symbols.slice(start, start + pageSize);
};

// 6. Fetch all timeframes data
const getAllTimeframesData = async (symbols: string[]) => {
  const { data, error } = await supabase
    .from('macd_signals')
    .select('*')
    .in('symbol', symbols)
    .in('timeframe', TIMEFRAMES)
    .order('date', { ascending: false });

  if (error) throw error;
  return data;
};

// 7. Fetch historical data (180 days)
const getHistoricalData = async (symbols: string[]) => {
  const allData = await Promise.all(
    symbols.map(async (symbol) => {
      const { data, error } = await supabase
        .from('macd_signals')
        .select('*')
        .eq('symbol', symbol)
        .order('date', { ascending: false });

      if (error) throw error;
      return data.reverse(); // Return in chronological order
    })
  );

  return allData.flat(); 
};



// 8. Group data by symbol
const groupData = (timeframes: MacdSignal[], history: MacdSignal[]): GroupedData => {
  const grouped: GroupedData = {};

  for (const row of timeframes) {
    const { symbol, timeframe } = row;
    if (!grouped[symbol]) grouped[symbol] = { timeframes: {}, allHistory: [] };
    if (!grouped[symbol].timeframes[timeframe]) grouped[symbol].timeframes[timeframe] = row;
  }

  for (const row of history) {
    if (!grouped[row.symbol]) grouped[row.symbol] = { timeframes: {}, allHistory: [] };
    grouped[row.symbol].allHistory.push(row);
  }

  return grouped;
};

// 9. Build final data
const buildStockResult = (
  paginatedSymbols: string[],
  latestBySymbol: Map<string, MacdSignal>,
  grouped: GroupedData
): SingleStockWithMacdHistory[] => {
  return paginatedSymbols
    .filter(symbol => {
      const base = latestBySymbol.get(symbol);
      if (!base) {
        console.warn(`No base data found for symbol: ${symbol}`);
        return false;
      }
      return true;
    })
    .map(symbol => {
      const base = latestBySymbol.get(symbol)!;
      const groupedData = grouped[symbol] || { timeframes: {}, allHistory: [] };

      const signalPerTimeframe = TIMEFRAMES.reduce((acc, tf) => {
        const tfData = groupedData.timeframes[tf];
        acc[tf] = tfData
          ? [{
              date: tfData.date,
              signal_1: tfData.signal_1,
              signal_2: tfData.signal_2,
              signal_3: tfData.signal_3,
              signal_4: tfData.signal_4,
              signal_5: tfData.signal_5,
              signal_6: tfData.signal_6,
              signal_7: tfData.signal_7
            }]
          : [];
        return acc;
      }, {} as Record<string, SignalFlags[]>);

      const macdHistoryByTf: Record<string, MacdHistoryEntry[]> = {};

      TIMEFRAMES.forEach(tf => {
        const tfRows = groupedData.allHistory
          .filter(row => row.timeframe === tf)
          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
          .slice(0, 60) // keep latest 60 rows
          .reverse(); // to keep chronological order if needed

        macdHistoryByTf[tf] = tfRows.map(row => ({
          date: row.date,
          macdLine: row.macd_line,
          signalLine: row.signal_line,
          histogram: row.macd_histogram
        }));
      });

      const sortedHistory = groupedData.allHistory
        .filter(row => row.timeframe === '1d')                      // only '1d' timeframe
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());  // sort by date ascending

      const priceHistory = sortedHistory
        .slice(-180)  // get the most recent 180 rows
        .map(row => ({
          date: row.date,
          price: row.close_price
        }));

      const change = calculatePriceChange(priceHistory);
      return {
        symbol: base.symbol,
        name: base.symbol,
        price: base.close_price,
        change,
        macdHistory: macdHistoryByTf,
        priceHistory,
        signals: signalPerTimeframe,
      };
    });
};


const TIMEFRAMES = ['1d', '2d', '3d', '5d', '1wk', '2wk', '3wk', '1mo', '2mo', '3mo', '4mo', '5mo'];

export const fetchStocksPageFromSupabase = async (
  page: number,
  pageSize: number,
  sortConfig?: SortConfig,
  selectedTimeframes?: TimeFrame[],
  macdDays?: number,
  priceChartDays?: number,
  enabledSignals?: SignalDisplayConfig[],
  signalPersistenceDays?: number,
  assetType?: string,
  searchQuery?: string
): Promise<{ data: SingleStockWithMacdHistory[]; total: number; uniqueSymbolCount: number }> => {
  try {
    const total = await getSymbolCount(assetType, searchQuery);
    const uniqueSymbolCount = await getUniqueSymbolCount();

    const latestSignals = await getLatestSignals(assetType, searchQuery);
    const latestBySymbol = new Map(latestSignals.map(s => [s.symbol, s]));

    let sortedSymbols: string[];
    let signalCounts: Map<string, number> | undefined;

    // If no sort config is provided, default to sorting by symbol in ascending order
    const effectiveSortConfig = sortConfig || { field: 'symbol', direction: 'asc' };

    if (effectiveSortConfig.field && ['1d', '2d', '3d', '5d', '1wk', '2wk', '3wk', '1mo', '2mo', '3mo', '4mo', '5mo'].includes(effectiveSortConfig.field)) {
      const sorted = await getSortedSymbolsBySignal(effectiveSortConfig.field, effectiveSortConfig.direction, assetType, searchQuery);
      sortedSymbols = sorted.sortedSymbols;
      signalCounts = sorted.signalCounts;
    } else if (effectiveSortConfig.field === 'price') {
      // Sort by price
      sortedSymbols = Array.from(latestBySymbol.keys()).sort((a, b) => {
        const priceA = latestBySymbol.get(a)?.close_price || 0;
        const priceB = latestBySymbol.get(b)?.close_price || 0;
        return effectiveSortConfig.direction === 'asc' ? priceA - priceB : priceB - priceA;
      });
    } else {
      // Default to sorting by symbol
      sortedSymbols = Array.from(latestBySymbol.keys()).sort((a, b) =>
        effectiveSortConfig.direction === 'asc' ? a.localeCompare(b) : b.localeCompare(a)
      );
    }

    const paginatedSymbols = paginateSymbols(sortedSymbols, page, pageSize);

    const [timeframesData, historicalData] = await Promise.all([
      getAllTimeframesData(paginatedSymbols),
      getHistoricalData(paginatedSymbols)
    ]);

    const grouped = groupData(timeframesData, historicalData);

    const result = buildStockResult(paginatedSymbols, latestBySymbol, grouped);

    return { data: result, total, uniqueSymbolCount };
  } catch (error) {
    console.error('Error fetching stocks:', error);
    return { data: [], total: 0, uniqueSymbolCount: 0 };
  }
};

export const fetchWatchlistStocksFromSupabase = async (
  watchlistSymbols: string[],
  assetType?: string,
  page: number = 0,
  pageSize: number = 20,
  sortConfig?: SortConfig
): Promise<{ data: SingleStockWithMacdHistory[]; total: number; uniqueSymbolCount: number }> => {
  try {
    if (!watchlistSymbols.length) return { data: [], total: 0, uniqueSymbolCount: 0 };

    const latestSignals = await getWatchlistSignals(watchlistSymbols);

    const latestBySymbol = new Map(
      latestSignals
        .filter(s => watchlistSymbols.includes(s.symbol))
        .map(s => [s.symbol, s])
    );

    let sortedSymbols: string[] = Array.from(latestBySymbol.keys());

    if (sortConfig?.field && ['1d', '2d', '3d', '5d', '1wk', '2wk', '3wk', '1mo', '2mo', '3mo', '4mo', '5mo'].includes(sortConfig.field)) {
      const sorted = await getSortedSymbolsBySignal(sortConfig.field, sortConfig.direction, assetType);
      sortedSymbols = sorted.sortedSymbols.filter(symbol => latestBySymbol.has(symbol));
    } else if (sortConfig?.field === 'price') {
      sortedSymbols.sort((a, b) => {
        const priceA = latestBySymbol.get(a)?.close_price || 0;
        const priceB = latestBySymbol.get(b)?.close_price || 0;
        return sortConfig.direction === 'asc' ? priceA - priceB : priceB - priceA;
      });
    } else if (sortConfig?.field === 'symbol') {
      sortedSymbols.sort((a, b) =>
        sortConfig.direction === 'asc' ? a.localeCompare(b) : b.localeCompare(a)
      );
    }

    const paginatedSymbols = paginateSymbols(sortedSymbols, page, pageSize);


    const [timeframesData, historicalData] = await Promise.all([
      getAllTimeframesData(paginatedSymbols),
      getHistoricalData(paginatedSymbols)
    ]);

    const grouped = groupData(timeframesData, historicalData);

    const result = buildStockResult(paginatedSymbols, latestBySymbol, grouped);

    return {
      data: result,
      total: sortedSymbols.length,
      uniqueSymbolCount: sortedSymbols.length
    };
  } catch (error) {
    console.error('Error fetching watchlist stocks:', error);
    return { data: [], total: 0, uniqueSymbolCount: 0 };
  }
};

type SignalKey = `signal_${1 | 2 | 3 | 4 | 5 | 6 | 7}`;

type Signal = {
  date: string;
  timeframe: string;
  close_price: number;
  symbol: string;
} & {
  [K in SignalKey]: boolean;
};


type SignalEntry = {
  date: string;
  allSignals: Record<string, boolean>;
};

type TriggeredEntry = {
  date: string;
  triggered_signals: string[];
};

export const getStockTriggeredSignals = async (
  symbol: string
): Promise<StockSignalResponse | undefined> => {
  try {
    const signals = await getSingleSignal(symbol);
    if (!signals || signals.length === 0) return undefined;

    const groupedByTimeframe: Record<string, TriggeredSignalRecord[]> = {};
    for (const signal of signals) {
      if (!groupedByTimeframe[signal.timeframe]) {
        groupedByTimeframe[signal.timeframe] = [];
      }
      groupedByTimeframe[signal.timeframe].push(signal);
    }

    const signalsByTimeframe: Record<string, SignalEntry[]> = {};
    const triggeredSignalsByTimeframe: Record<string, TriggeredEntry[]> = {};

    for (const timeframe in groupedByTimeframe) {
      const signals = groupedByTimeframe[timeframe].slice().reverse();
      signalsByTimeframe[timeframe] = [];
      triggeredSignalsByTimeframe[timeframe] = [];

      for (const signal of signals) {
        const allSignals: Record<string, boolean> = {};
        for (let i = 1; i <= 7; i++) {
          const key = `signal_${i}`;
          allSignals[key] = signal[key];
        }
        
        signalsByTimeframe[timeframe].push({
          date: signal.date,
          allSignals,
        });

        triggeredSignalsByTimeframe[timeframe].push({
          date: signal.date,
          triggered_signals: signal.triggered_signals || [],
        });
      }
    }

    const dailySignals = signals.filter(s => s.timeframe === '1d').sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const latest = dailySignals[dailySignals.length - 1];

    
    // Calculate price change using the same method as the table
    const priceHistory = signals
      .filter(s => s.timeframe === '1d')
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .map(s => ({
        date: s.date,
        price: s.close_price
      }));

    const change = calculatePriceChange(priceHistory);

    let companyName = latest.symbol;
    for (const category in mappingDirectory) {
      if (mappingDirectory[category][latest.symbol]) {
        companyName = mappingDirectory[category][latest.symbol];
        break;
      }
    }

    return {
      symbol: latest.symbol,
      name: companyName,
      price: latest.close_price,
      change,
      signals: signalsByTimeframe,
      triggeredSignals: triggeredSignalsByTimeframe,
    };
  } catch (error) {
    console.error('Error fetching stock from Supabase:', error);
    throw error;
  }
};
