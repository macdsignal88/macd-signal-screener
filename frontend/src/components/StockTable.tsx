import { ArrowDownCircle, ArrowUpCircle, Copy, ExternalLink, RefreshCw, Search } from 'lucide-react';
import {
  ColumnDef,
  Row,
  SortingState,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import React, { Profiler, memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { Signal, SignalDisplayConfig, SignalFlags, SingleStockWithMacdHistory, SortConfig, SortDirection, SortField, StockWithMacdHistory, TimeFrame } from '@/lib/types';
import { fetchStocksPageFromSupabase, fetchWatchlistStocksFromSupabase, getLatestCreatedAt } from '@/lib/supabaseService';
import { formatPercent, formatPrice } from '@/lib/macdService';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import MacdMiniChart from '@/components/MacdMiniChart';
import MiniPriceChart from './MiniPriceChart';
import { Progress } from '@/components/ui/progress';
import { SettingsDialog } from '@/components/SettingsDialog';
import SignalIndicator from '@/components/SignalIndicator';
import StockHeaderCell from '@/components/StockHeaderCell';
import { Switch } from '@/components/ui/switch';
import ThemeToggle from '@/components/ThemeToggle';
import WatchlistButton from '@/components/WatchlistButton';
import { cn } from '@/lib/utils';
import { debounce } from 'lodash';
import mappingDirectory from '../lib/mapping_directory.json';
import { signOut } from '@/lib/supabaseAuth';
import { useMode } from '@/context/ModeContext';
import { useNavigate } from 'react-router-dom';
import { useSearchParams } from 'react-router-dom';
import { useSettings } from '@/context/SettingsContext';
import { useToast } from '@/hooks/use-toast';
import { useWatchlist } from '@/context/WatchlistContext';

const CURRENT_VERSION = '1.1.0'; 
// Add constants for local storage keys
const STORAGE_KEYS = {
  SELECTED_TIMEFRAMES: `macd-screener-${CURRENT_VERSION}-timeframes`,
  MACD_DAYS: `macd-screener-${CURRENT_VERSION}-macd-days`,
  PRICE_CHART_DAYS: `macd-screener-${CURRENT_VERSION}-price-chart-days`,
  SIGNAL_CONFIG: `macd-screener-${CURRENT_VERSION}-signal-config`,
  ROWS_PER_PAGE: `macd-screener-${CURRENT_VERSION}-rows-per-page`
};

const DEFAULT_SORT: SortConfig = { field: 'symbol', direction: 'asc' };
const DEFAULT_MACD_DAYS = 7;
const DEFAULT_PRICE_CHART_DAYS = 30;

// Add a cache service to store frequently accessed data
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes
const CACHE_KEY = 'stock-table-cache';

// Add cache types
interface CacheData {
  data: SingleStockWithMacdHistory[];
  total: number;
  uniqueSymbolCount: number;
  timestamp: number;
}

interface Cache {
  [key: string]: CacheData;
}

// Initialize cache from localStorage
const initializeCache = (): Cache => {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as Cache;
      // Clear expired cache entries
      const now = Date.now();
      Object.keys(parsed).forEach(key => {
        if (now - parsed[key].timestamp > 5 * 60 * 1000) {
          delete parsed[key];
        }
      });
      return parsed;
    }
  } catch (error) {
    console.error('Error initializing cache:', error);
  }
  return {};
};

const stockCache = initializeCache();

// Helper function to validate sort field
const isValidSortField = (field: string): field is SortField => {
  return [
    'symbol', 'name', 'price', 'change',
    '1d', '2d', '3d', '5d', '1wk', '2wk', '3wk', '1mo', '2mo', '3mo', '4mo', '5mo'
  ].includes(field);
};

// Function to calculate total positive signals for a timeframe
const getTotalPositiveSignals = (timeframeSignals: SignalFlags[] | null, timeFrame: TimeFrame) => {
  if (!timeframeSignals || timeframeSignals.length === 0) return 0;
  const latestSignal = timeframeSignals[0];
  return Object.entries(latestSignal)
    .filter(([key]) => key.startsWith('signal_'))
    .reduce((sum, [_, value]) => sum + (value ? 1 : 0), 0);
};

// Add Profiler callback
const onRenderCallback = (
  id: string,
  phase: string,
  actualDuration: number,
  baseDuration: number,
  startTime: number,
  commitTime: number,
) => {
  console.log(`[Profiler] ${id} - ${phase}:
    Actual duration: ${actualDuration.toFixed(2)}ms
    Base duration: ${baseDuration.toFixed(2)}ms
    Start time: ${startTime.toFixed(2)}ms
    Commit time: ${commitTime.toFixed(2)}ms
  `);
};

// Move utility functions outside component
const normalizeTimeFrame = (tf: string): string => {
  const map: Record<string, string> = {
    '1d': '1d', '2d': '2d', '3d': '3d', '5d': '5d',
    '1wk': '1wk', '2wk': '2wk', '3wk': '3wk',
    '1mo': '1mo', '2mo': '2mo', '3mo': '3mo', '4mo': '4mo', '5mo': '5mo'
  };
  return map[tf] || tf;
};

const getSortedTimeframes = (timeframes: TimeFrame[]): TimeFrame[] => {
  const timeframeOrder: { [key: string]: number } = {
    '1d': 1, '2d': 2, '3d': 3, '5d': 4,
    '1wk': 5, '2wk': 6, '3wk': 7,
    '1mo': 8, '2mo': 9, '3mo': 10, '4mo': 11, '5mo': 12
  };
  return [...timeframes].sort((a, b) => timeframeOrder[a] - timeframeOrder[b]);
};

// Move columns definition outside component
const createColumns = (
  sortedSelectedTimeframes: TimeFrame[],
  sorting: SortingState,
  priceChartDays: number,
  macdDays: number,
  selectedTimeFrame: TimeFrame,
  handleSort: (field: SortField) => void,
  getFilteredSignals: (timeframeSignals: SignalFlags[] | null, timeFrame: TimeFrame) => Signal[],
  getTotalPositiveSignals: (timeframeSignals: SignalFlags[] | null, timeFrame: TimeFrame) => number,
  setSelectedTimeFrame: (timeFrame: TimeFrame) => void,
  navigate: (url: string) => void
): ColumnDef<SingleStockWithMacdHistory>[] => [
  {
    id: 'watchlist',
    header: () => null,
    cell: ({ row }) => <WatchlistButton symbol={row.original.symbol} />,
    size: 40,
  },
  {
    id: 'symbol',
    header: () => <StockHeaderCell 
      label="Symbol & Name" 
      field="symbol" 
      currentSort={sorting.find(s => s.id === 'symbol')} 
      onSort={() => handleSort('symbol')} 
    />,
    cell: ({ row }) => {
      // Find the company name from the mapping directory
      let companyName = row.original.symbol;
      for (const category in mappingDirectory) {
        if (mappingDirectory[category][row.original.symbol]) {
          companyName = mappingDirectory[category][row.original.symbol];
          break;
        }
      }
      
      const currentParams = new URLSearchParams(window.location.search);
      const baseUrl = window.location.origin;
      const url = `${baseUrl}/stock/${encodeURIComponent(row.original.symbol)}${currentParams.toString() ? `?${currentParams.toString()}` : ''}`;
      
      return (
        <a 
          className="flex flex-col cursor-pointer hover:text-primary transition-colors"
          onClick={(e) => {
            e.preventDefault();
            console.log('Opening stock in new tab:', url);
            const newWindow = window.open(url, '_blank', 'noopener,noreferrer');
            if (!newWindow) {
              console.warn('Popup blocked or failed to open new window');
              // Fallback: do nothing, or show a message
            }
          }}
          tabIndex={0}
          role="link"
        >
          <span className="font-medium">{row.original.symbol}</span>
          <span className="text-sm text-muted-foreground">{companyName}</span>
        </a>
      );
    },
    size: 200,
  },
  {
    id: 'price',
    header: () => <StockHeaderCell 
      label="Price & Change" 
      field="price" 
      currentSort={sorting.find(s => s.id === 'price')} 
      onSort={() => handleSort('price')} 
    />,
    cell: ({ row }) => {
      const stock = row.original;
      return (
        <div className="flex flex-col">
          <span className="font-medium">{formatPrice(stock.price)}</span>
          <span className={`text-sm ${stock.change >= 0 ? 'text-signal-positive' : 'text-signal-negative'}`}>
            {formatPercent(stock.change)}
          </span>
          <div className="h-[60px] mt-1">
            <MiniPriceChart
              data={stock.priceHistory}
              days={priceChartDays}
            />
          </div>
        </div>
      );
    },
    size: 200,
  },
  ...sortedSelectedTimeframes.map(timeFrame => ({
    id: timeFrame,
    header: () => <StockHeaderCell 
      label={timeFrame} 
      field={timeFrame} 
      currentSort={sorting.find(s => s.id === `signal_count_${timeFrame}`)} 
      onSort={() => handleSort(timeFrame)} 
    />,
    cell: ({ row }) => {
      const normalizedTimeFrame = normalizeTimeFrame(timeFrame);
      const timeframeSignals = row.original.signals?.[normalizedTimeFrame];
    
      if (!timeframeSignals) {
        console.warn("No timeframe signals found.");
        return null;
      }
    
      const filteredSignals = getFilteredSignals(timeframeSignals, timeFrame);
      const signalCount = {
        timeFrame,
        positiveCount: filteredSignals.filter(s => s.value).length,
        totalPossible: filteredSignals.length
      };
      
      return (
        <div 
          className="cursor-pointer hover:bg-muted/30 transition-colors rounded p-1"
          onClick={() => setSelectedTimeFrame(timeFrame)}
        >
          <div className="flex flex-wrap justify-center gap-1.5 py-1">
            {filteredSignals.map((signal) => (
              <SignalIndicator
                key={`${row.original.symbol}-${timeFrame}-${signal.type}`}
                value={signal.value}
                signalType={signal.type}
                size="sm"
              />
            ))}
          </div>
          <div className="text-xs text-center mt-1 font-medium">
            <span className={`${signalCount.positiveCount > signalCount.totalPossible / 2 ? 'text-signal-positive' : 'text-muted-foreground'}`}>
              {signalCount.positiveCount}/{signalCount.totalPossible}
            </span>
          </div>
        </div>
      );
    },
    sortingFn: (rowA, rowB, columnId) => {
      const timeFrame = columnId as TimeFrame;
      const normalizedTimeFrame = normalizeTimeFrame(timeFrame);
      
      const signalsA = rowA.original.signals?.[normalizedTimeFrame] || [];
      const signalsB = rowB.original.signals?.[normalizedTimeFrame] || [];
      
      const countA = getTotalPositiveSignals(signalsA, timeFrame);
      const countB = getTotalPositiveSignals(signalsB, timeFrame);
      
      // Get the current sort direction from the sorting state
      const currentSort = sorting.find(s => s.id === columnId);
      const isDesc = currentSort?.desc ?? false;
      
      // Apply the sort direction
      return isDesc ? countB - countA : countA - countB;
    },
    size: 140,
  })),
  {
    id: 'macd',
    header: `MACD (${selectedTimeFrame})`,
    cell: ({ row }) => {
      const stock = row.original;
      const timeframeData = stock.macdHistory[selectedTimeFrame] || [];
      return (
        <div className="w-[160px] h-[60px]">
          <MacdMiniChart
            data={timeframeData}
            selectedTimeFrame={selectedTimeFrame}
            days={macdDays}
          />
        </div>
      );
    },
    size: 160,
  },
];

export const StockTableComponent: React.FC = () => {
  const { 
    selectedTimeframes, 
    macdDays, 
    priceChartDays, 
    enabledSignals,
    signalPersistenceDays,
    setSelectedTimeframes,
    setMacdDays,
    setPriceChartDays,
    setEnabledSignals,
    setSignalPersistenceDays
  } = useSettings();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { watchlist } = useWatchlist();
  const [searchParams, setSearchParams] = useSearchParams();
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(() => {
    const savedPageSize = localStorage.getItem(STORAGE_KEYS.ROWS_PER_PAGE);
    return savedPageSize ? parseInt(savedPageSize, 10) : 50;
  });
  const [totalRows, setTotalRows] = useState(0);
  const [uniqueSymbolCount, setUniqueSymbolCount] = useState(0);
  const [selectedAssetGroup, setSelectedAssetGroup] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sorting, setSorting] = useState<SortingState>([]);
  const [sortConfig, setSortConfig] = useState<SortConfig>(() => {
    const sortField = searchParams.get('sortField');
    const sortDirection = searchParams.get('sortDirection') as 'asc' | 'desc';
    if (sortField && isValidSortField(sortField) && sortDirection) {
      return { field: sortField, direction: sortDirection };
    }
    return DEFAULT_SORT;
  });
  const [showWatchlistOnly, setShowWatchlistOnly] = useState(false);
  const [stocks, setStocks] = useState<SingleStockWithMacdHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [selectedTimeFrame, setSelectedTimeFrame] = useState<TimeFrame>('1d');
  const [isUsingCache, setIsUsingCache] = useState(false);
  const [lastCacheTime, setLastCacheTime] = useState<number | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [cache, setCache] = useState<Cache>({});
  const { mode, setMode } = useMode();
  
  // Get sorted timeframes for display
  const sortedSelectedTimeframes = useMemo(() => 
    getSortedTimeframes(selectedTimeframes), 
    [selectedTimeframes]
  );

  // Add cache functions
  const getCachedData = (key: string): CacheData | null => {
    // Check component state cache first
    const cached = cache[key];
    if (cached) {
      const now = Date.now();
      if (now - cached.timestamp > 5 * 60 * 1000) { // 5 minutes cache
        setCache(prev => {
          const newCache = { ...prev };
          delete newCache[key];
          return newCache;
        });
        return null;
      }
      return cached;
    }
    
    // Check global cache as fallback
    const globalCached = stockCache[key];
    if (globalCached) {
      const now = Date.now();
      if (now - globalCached.timestamp > 5 * 60 * 1000) { // 5 minutes cache
        delete stockCache[key];
        return null;
      }
      // Move from global cache to component cache
      setCachedData(key, globalCached.data, globalCached.total, globalCached.uniqueSymbolCount);
      return globalCached;
    }
    
    return null;
  };

  const setCachedData = (key: string, data: SingleStockWithMacdHistory[], total: number, uniqueSymbolCount: number) => {
    const cacheData = {
      data,
      total,
      uniqueSymbolCount,
      timestamp: Date.now()
    };
    
    // Update component state cache
    setCache(prev => ({
      ...prev,
      [key]: cacheData
    }));
    
    // Also update global cache
    stockCache[key] = cacheData;
    
    // Persist to localStorage
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(stockCache));
    } catch (error) {
      console.error('Error saving cache to localStorage:', error);
    }
  };

  const clearCache = () => {
    setCache({});
    // Clear global cache
    Object.keys(stockCache).forEach(key => delete stockCache[key]);
    // Clear localStorage
    try {
      localStorage.removeItem(CACHE_KEY);
    } catch (error) {
      console.error('Error clearing cache from localStorage:', error);
    }
  };

  // Update search handler to trigger search immediately
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const searchValue = e.target.value;
    setSearchQuery(searchValue);
    setPageIndex(0); // Reset to first page
    loadStocks(); // This will now use the searchQuery in the API call
  };

  // Update loadStocks to handle loading state internally
  const loadStocks = useCallback(async (page = pageIndex, size = pageSize) => {
    const startTime = performance.now();
    setLoading(true);
    try {
      // Generate cache key based on current state
      const cacheKey = JSON.stringify({
        page,
        size,
        selectedAssetGroup: selectedAssetGroup,
        searchQuery: searchQuery,
        sorting: sorting,
        showWatchlistOnly: showWatchlistOnly,
        ...(showWatchlistOnly ? { watchlist } : {}),
        selectedTimeframes,
        macdDays,
        priceChartDays,
        enabledSignals,
        signalPersistenceDays,
        mode
      });

      // Try to get cached data first
      const cachedData = getCachedData(cacheKey);
      if (cachedData) {
        console.log('Using cached data for page:', page, 'with', cachedData.data.length, 'stocks');
        setStocks(cachedData.data);
        setTotalRows(cachedData.total);
        setUniqueSymbolCount(cachedData.uniqueSymbolCount);
        setLoading(false);
        return;
      }

      console.log('No cached data found, fetching from database...');
      console.log('Cache key:', cacheKey);
      console.log('Current cache state:', Object.keys(cache).length, 'entries');
      console.log('Global cache state:', Object.keys(stockCache).length, 'entries');

      // If no cached data, fetch from Supabase
      console.log('Fetching data with mode:', mode);
      const { data, total, uniqueSymbolCount } = showWatchlistOnly
        ? await fetchWatchlistStocksFromSupabase(watchlist, selectedAssetGroup === 'all' ? undefined : selectedAssetGroup, pageIndex, pageSize, sorting.length > 0 ? {
            field: sorting[0].id as SortField,
            direction: sorting[0].desc ? 'desc' : 'asc'
          } : sortConfig, mode)
        : await fetchStocksPageFromSupabase(
            pageIndex,
            pageSize,
            sorting.length > 0 ? {
              field: sorting[0].id as SortField,
              direction: sorting[0].desc ? 'desc' : 'asc'
            } : sortConfig,
            selectedTimeframes,
            macdDays,
            priceChartDays,
            enabledSignals,
            signalPersistenceDays,
            selectedAssetGroup === 'all' ? undefined : selectedAssetGroup,
            searchQuery,
            mode
          );

      console.log('Fetched data:', { dataLength: data?.length, total, uniqueSymbolCount });

      // Cache the fetched data
      console.log('Caching data for page:', page);
      setCachedData(cacheKey, data, total || 0, uniqueSymbolCount);

      setStocks(data);
      setTotalRows(total || 0);
      setUniqueSymbolCount(uniqueSymbolCount);
    } catch (error) {
      console.error('Error fetching stocks:', error);
      toast({
        title: 'Error loading stocks',
        description: 'There was a problem loading stock data. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
      const endTime = performance.now();
      console.log(`[Performance] loadStocks took ${(endTime - startTime).toFixed(2)}ms`);
    }
  }, [pageIndex, pageSize, selectedAssetGroup, searchQuery, sorting, showWatchlistOnly, watchlist, selectedTimeframes, macdDays, priceChartDays, enabledSignals, signalPersistenceDays, sortConfig, mode]);

  // Memoize filtered stocks
  const filteredStocks = useMemo(() => {
    if (!showWatchlistOnly) return stocks;
    return stocks.filter(stock => watchlist.includes(stock.symbol));
  }, [stocks, showWatchlistOnly, watchlist]);

  // Asset group options from mappingDirectory
  const assetGroupOptions = useMemo(() => Object.keys(mappingDirectory), []);

  // Update when watchlist filter changes
  useEffect(() => {
    if (showWatchlistOnly) {
      loadStocks();
    }
  }, [loadStocks, showWatchlistOnly]);

  // Update when other filters change
  useEffect(() => {
    loadStocks();
  }, [loadStocks, selectedAssetGroup, searchQuery, sorting, selectedTimeframes, macdDays, priceChartDays, enabledSignals, signalPersistenceDays]);

  // Calculate total pages
  const totalPages = useMemo(() => {
    if (showWatchlistOnly) return 1;
    return Math.max(1, Math.ceil(uniqueSymbolCount  / pageSize));
  }, [uniqueSymbolCount , pageSize, showWatchlistOnly]);

  const handleRefresh = () => {
    clearCache(); // Clear cache before refreshing
    loadStocks();
    toast({
      title: 'Refreshing data',
      description: 'Updating stock signals...',
      duration: 1500,
    });
  };



  // Save settings to local storage when they change
  useEffect(() => {
    const storedVersion = localStorage.getItem("VERSION");
  
    if (storedVersion !== CURRENT_VERSION) {
      localStorage.setItem("VERSION", CURRENT_VERSION);
      localStorage.setItem(STORAGE_KEYS.SELECTED_TIMEFRAMES, JSON.stringify(selectedTimeframes));
    }
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

  // Update handleTimeframesChange to avoid reloading when only adding timeframes
  const handleTimeframesChange = useCallback((newTimeframes: TimeFrame[]) => {
    try {
      // Check if we're only adding timeframes (newTimeframes is a superset of selectedTimeframes)
      const isOnlyAdding = newTimeframes.length > selectedTimeframes.length && 
        selectedTimeframes.every(tf => newTimeframes.includes(tf));
      
      setSelectedTimeframes(newTimeframes);
      
      // Only reload data if we're removing timeframes
      if (!isOnlyAdding) {
        loadStocks();
      }
    } catch (error) {
      console.error('Error saving timeframes:', error);
      toast({
        title: 'Error saving settings',
        description: 'Your timeframe settings could not be saved.',
        variant: 'destructive',
      });
    }
  }, [selectedTimeframes, loadStocks, toast]);

  // Filter signals based on enabled configuration
  const getFilteredSignals = useCallback((timeframeSignals: SignalFlags[] | null, timeFrame: TimeFrame) => {
    if (!timeframeSignals || timeframeSignals.length === 0) {
      return enabledSignals
        .filter(config => config.enabled)
        .map(config => ({
          type: config.type,
          value: false,
          timeFrame,
          date: new Date().toISOString()
        }));
    }
  
    const latestSignal = timeframeSignals[0]; // Most recent signal
    
  
    return enabledSignals
    .filter(config => config.enabled)
    .map(config => {
      const key = `signal_${config.type.split('_')[1]}`;
      const value = latestSignal[key as keyof typeof latestSignal];
      
      return {
        type: config.type,
        value: value as boolean,
        timeFrame,
        date: latestSignal.date
      };
    });
  }, [enabledSignals]);
  

  // Update handleMacdDaysChange to ensure signals are generated for all timeframes
  const handleMacdDaysChange = (days: number) => {
    try {
      setMacdDays(days);
    } catch (error) {
      console.error('Error saving MACD days:', error);
      toast({
        title: 'Error saving settings',
        description: 'Your MACD days setting could not be saved.',
        variant: 'destructive',
      });
    }
  };

  // Update handlePriceChartDaysChange to ensure signals are generated for all timeframes
  const handlePriceChartDaysChange = (days: number) => {
    try {
      setPriceChartDays(days);
    } catch (error) {
      console.error('Error saving price chart days:', error);
      toast({
        title: 'Error saving settings',
        description: 'Your price chart days setting could not be saved.',
        variant: 'destructive',
      });
    }
  };

  // Update handleSignalConfigChange to ensure signals are generated for all timeframes
  const handleSignalConfigChange = (config: SignalDisplayConfig[]) => {
    try {
      setEnabledSignals(config);
    } catch (error) {
      console.error('Error saving signal config:', error);
      toast({
        title: 'Error saving settings',
        description: 'Your signal configuration could not be saved.',
        variant: 'destructive',
      });
    }
  };

  const handleSignalPersistenceDaysChange = (days: number) => {
    try {
      setSignalPersistenceDays(days);
    } catch (error) {
      console.error('Error saving signal persistence days:', error);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut();
      navigate('/login');
    } catch (error) {
      console.error('Error signing out:', error);
      toast({
        title: "Error",
        description: "Failed to sign out. Please try again.",
        variant: "destructive"
      });
    }
  };

  // Update sortConfig when URL parameters change
  useEffect(() => {
    console.log('URL parameters changed:', {
      sortField: searchParams.get('sortField'),
      sortDirection: searchParams.get('sortDirection'),
      allParams: Object.fromEntries(searchParams.entries())
    });

    const sortField = searchParams.get('sortField') as SortField;
    const sortDirection = searchParams.get('sortDirection') as 'asc' | 'desc';
    if (sortField && sortDirection && isValidSortField(sortField)) {
      console.log('Updating sortConfig from URL:', { field: sortField, direction: sortDirection });
      setSortConfig({ field: sortField, direction: sortDirection });
      // Update sorting state to match URL
      setSorting([{ id: sortField, desc: sortDirection === 'desc' }]);
    } else {
      console.log('Using default sort config:', DEFAULT_SORT);
      setSortConfig(DEFAULT_SORT);
      // Update sorting state to match default
      setSorting([{ id: DEFAULT_SORT.field, desc: DEFAULT_SORT.direction === 'desc' }]);
    }
  }, [searchParams]);

    // Update handleSort to handle both sorting state and URL updates
  const handleSort = useCallback((field: SortField) => {
    console.log('handleSort called with field:', field);
    const sortField = field === '2d' || field === '3d' || field === '5d' ? field : field;
    
    setSorting(prev => {
      const currentSort = prev.find(sort => sort.id === sortField);
      console.log('Current sorting state:', {
        prev,
        currentSort,
        field: sortField
      });
      
      const newSorting = currentSort
        ? prev.map(sort => 
            sort.id === sortField 
              ? { ...sort, desc: !sort.desc }
              : sort
          )
        : [{ id: sortField, desc: false }];
      
      console.log('New sorting state:', newSorting);
      
      // Update URL with new sorting state
      const newSort = newSorting[0];
      if (newSort) {
        setSearchParams(prev => {
          prev.set('sortField', newSort.id);
          prev.set('sortDirection', newSort.desc ? 'desc' : 'asc');
          return prev;
        });
      }
      
      return newSorting;
    });
  }, [setSearchParams]);

  // Add function to fetch last update time
  const fetchLastUpdate = async () => {
    try {
      const response = await getLatestCreatedAt();
      if (response) {
        const formattedDate = response.toISOString().split("T")[0]; // "YYYY-MM-DD"
        setLastUpdated(formattedDate);
      }
    } catch (error) {
      console.error("Error fetching last update time:", error);
      // Set a fallback date if the API fails
      setLastUpdated(new Date().toISOString().split("T")[0]);
    }
  };
  

  // Fetch last update time when component mounts
  useEffect(() => {
    fetchLastUpdate();
  }, []);

  // Add effect to save page size when it changes
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.ROWS_PER_PAGE, pageSize.toString());
  }, [pageSize]);

  // Memoize columns
  const columns = useMemo(() => 
    createColumns(
      sortedSelectedTimeframes,
      sorting,
      priceChartDays,
      macdDays,
      selectedTimeFrame,
      handleSort,
      getFilteredSignals,
      getTotalPositiveSignals,
      setSelectedTimeFrame,
      navigate
    ),
    [sortedSelectedTimeframes, sorting, priceChartDays, macdDays, selectedTimeFrame, handleSort, getFilteredSignals, getTotalPositiveSignals, setSelectedTimeFrame, navigate]
  );

  // Initialize table
  const table = useReactTable<SingleStockWithMacdHistory>({
    data: filteredStocks,
    columns,
    pageCount: totalPages,
    state: {
      sorting,
      pagination: {
        pageIndex: showWatchlistOnly ? 0 : pageIndex,
        pageSize: showWatchlistOnly ? filteredStocks.length : pageSize,
      },
    },
    onSortingChange: setSorting,
    onPaginationChange: (updater) => {
      if (typeof updater === 'function') {
        const newState = updater({ pageIndex, pageSize: pageSize });
        if (!showWatchlistOnly) {
          setPageIndex(newState.pageIndex);
          setPageSize(newState.pageSize);
        }
      }
    },
    manualPagination: true,
    manualSorting: sorting.length > 0 && !sorting[0].id.startsWith('signal_count_'),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  // Update row rendering with proper types
  const renderRow = useCallback((row: Row<SingleStockWithMacdHistory>) => (
    <tr
      key={row.id}
      className="stock-row hover:bg-muted/20 transition-colors"
    >
      {row.getVisibleCells().map(cell => (
        <td
          key={cell.id}
          className="px-4 py-3"
        >
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </td>
      ))}
    </tr>
  ), []);

  // Ensure we return valid JSX
  return (
    <div className="w-full">
      <Profiler id="StockTable" onRender={onRenderCallback}>
        <div className="w-full p-2 sm:p-4">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
            <h1 className="text-2xl font-bold sm:text-3xl">MACD Signal Screener</h1>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                {lastUpdated && (
                  <span>Last updated: {lastUpdated}</span>
                )}
                {isUsingCache && lastCacheTime && (
                  <span className="text-green-500">
                    (Using cached data from {new Date(lastCacheTime).toLocaleTimeString()})
                  </span>
                )}
              </div>
              {/* Asset group dropdown and search bar */}
              <div className="flex items-center gap-2">
                <Select value={selectedAssetGroup} onValueChange={setSelectedAssetGroup}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Asset Group" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Asset Groups</SelectItem>
                    {assetGroupOptions.map(group => (
                      <SelectItem key={group} value={group}>{group}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="text"
                  placeholder="Search stocks..."
                  value={searchQuery}
                  onChange={handleSearchChange}
                  className="w-[180px]"
                />
              </div>
              {/* Group ThemeToggle and Buy/Sell Toggle */}
              <div className="flex items-center gap-4">
                <ThemeToggle />
                <div className="flex items-center">
                  <span className={mode === 'buy' ? 'font-bold text-primary' : ''}>Buy</span>
                  <Switch
                    checked={mode === 'sell'}
                    onCheckedChange={(checked) => setMode(checked ? 'sell' : 'buy')}
                    className="mx-2"
                  />
                  <span className={mode === 'sell' ? 'font-bold text-primary' : ''}>Sell</span>
                </div>
              </div>
              <SettingsDialog
                selectedTimeframes={selectedTimeframes}
                macdDays={macdDays}
                priceChartDays={priceChartDays}
                enabledSignals={enabledSignals}
                signalPersistenceDays={signalPersistenceDays}
                onTimeframesChange={handleTimeframesChange}
                onMacdDaysChange={handleMacdDaysChange}
                onPriceChartDaysChange={handlePriceChartDaysChange}
                onSignalConfigChange={handleSignalConfigChange}
                onSignalPersistenceDaysChange={handleSignalPersistenceDaysChange}
              />
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleRefresh}
                disabled={loading}
                className="h-9 flex items-center gap-1"
              >
                <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                <span className="hidden sm:inline">Refresh</span>
              </Button>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleLogout}
              className="h-9 flex items-center gap-1"
            >
              Logout
            </Button>
          </div>

          <div className="flex items-center justify-between mt-4">
            <div className="flex items-center space-x-2">
              <Switch
                id="watchlist-filter"
                checked={showWatchlistOnly}
                onCheckedChange={() => {
                  setShowWatchlistOnly(!showWatchlistOnly);
                  setPageIndex(0);
                }}
              />
              <Label htmlFor="watchlist-filter" className="cursor-pointer">Show watchlist only</Label>
            </div>
            
            {showWatchlistOnly && watchlist.length === 0 && (
              <div className="text-sm text-muted-foreground">
                Your watchlist is empty. Add stocks by clicking the star icon.
              </div>
            )}
          </div>

          <div className="glass-card rounded-lg overflow-hidden mt-4">
            {loading ? (
              <div className="p-8 flex flex-col items-center justify-center">
                <Progress value={30} className="w-64 animate-pulse" />
                <p className="mt-4 text-sm text-muted-foreground">Loading stock data...</p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full divide-y divide-border">
                    <thead className="bg-muted/30">
                      {table.getHeaderGroups().map(headerGroup => (
                        <tr key={headerGroup.id}>
                          {headerGroup.headers.map(header => (
                            <th
                              key={header.id}
                              className="px-2 sm:px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider"
                              style={{ width: header.getSize() }}
                            >
                              {header.isPlaceholder
                                ? null
                                : flexRender(
                                    header.column.columnDef.header,
                                    header.getContext()
                                  )}
                            </th>
                          ))}
                        </tr>
                      ))}
                    </thead>
                    <tbody className="bg-background divide-y divide-border">
                      {table.getRowModel().rows.length === 0 ? (
                        <tr>
                          <td colSpan={columns.length} className="px-4 py-8 text-center text-muted-foreground">
                            {searchQuery || showWatchlistOnly 
                              ? 'No matching stocks found' 
                              : 'No stocks available'}
                          </td>
                        </tr>
                      ) : (
                        table.getRowModel().rows.map(renderRow)
                      )}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap justify-between items-center p-2 sm:p-4 gap-2">
                  <div>
                    Page {pageIndex + 1} of {totalPages}
                  </div>
                  <div className="flex flex-wrap gap-2 items-center">
                    <Button 
                      onClick={() => setPageIndex(0)} 
                      disabled={pageIndex === 0}
                    >
                      First
                    </Button>
                    <Button 
                      onClick={() => setPageIndex(pageIndex - 1)} 
                      disabled={pageIndex === 0}
                    >
                      Previous
                    </Button>
                    <Button 
                      onClick={() => setPageIndex(pageIndex + 1)} 
                      disabled={pageIndex >= totalPages - 1}
                    >
                      Next
                    </Button>
                    <Button 
                      onClick={() => setPageIndex(totalPages - 1)} 
                      disabled={pageIndex >= totalPages - 1}
                    >
                      Last
                    </Button>
                    <span className="ml-4">Rows per page:</span>
                    <select
                      value={pageSize}
                      onChange={e => {
                        setPageSize(Number(e.target.value));
                        setPageIndex(0);
                      }}
                      className="border rounded px-2 py-1"
                    >
                      {[10, 20, 50, 100].map(size => (
                        <option key={size} value={size}>{size}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </Profiler>
    </div>
  );
};

export default memo(StockTableComponent);

