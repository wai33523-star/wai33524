import { type FormEvent, type ReactNode, useMemo, useState } from 'react';
import {
  getGetFactorAnalysisQueryKey,
  getGetHistoricalBacktestQueryKey,
  getGetHsiQualityPicksQueryKey,
  getGetHsiQualityLaggardsQueryKey,
  getGetHsiRecoveryPicksQueryKey,
  getGetHsiLeaderPicksQueryKey,
  getGetHsiLeaderPullbackPicksQueryKey,
  getGetHsiMoversQueryKey,
  getGetHsiValuationPicksQueryKey,
  getGetHsiValueRecoveryPicksQueryKey,
  getGetMarketHistoryQueryKey,
  getGetRealtimeMarketDataQueryKey,
  getGetValuationAssessmentQueryKey,
  useGetFactorAnalysis,
  useGetHistoricalBacktest,
  useGetHsiQualityPicks,
  useGetHsiQualityLaggards,
  useGetHsiRecoveryPicks,
  useGetHsiLeaderPicks,
  useGetHsiLeaderPullbackPicks,
  useGetHsiMovers,
  useGetHsiValuationPicks,
  useGetHsiValueRecoveryPicks,
  useGetMarketHistory,
  useGetRealtimeMarketData,
  useGetValuationAssessment,
  type GetHistoricalBacktestParams,
  type HistoricalBacktest,
  type MarketHistory,
} from '@workspace/api-client-react';
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  Check,
  CircleHelp,
  Database,
  Download,
  Gauge,
  LineChart,
  Menu,
  RefreshCw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  X,
} from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { HsiHistoryPanel } from '@/components/hsi-history-panel';
import { HsiQualityPicks } from '@/components/hsi-quality-picks';
import { HsiStockFinder } from '@/components/hsi-stock-finder';
import { HsiValueRecoveryPicks, HsiValuationPicks, ValuationAssessmentCard } from '@/components/valuation-opportunity';

type ChartMode = 'momentum' | 'liquidity' | 'factors';

const popularTickers = ['HSI', '0700.HK', '9988.HK', 'AAPL'];
const REALTIME_REFRESH_INTERVAL_MS = 60_000;
const DATA_REFRESH_INTERVAL_MS = 5 * 60_000;
const VALUATION_REFRESH_INTERVAL_MS = 15 * 60_000;

function normalizeTickerInput(input: string) {
  const cleanInput = input.trim().toUpperCase();
  if (['HSI', '^HSI', '恆指', '恒指'].includes(cleanInput)) return '^HSI';
  if (/^\d+$/.test(cleanInput)) return `${cleanInput.padStart(4, '0')}.HK`;
  return cleanInput;
}

function formatNumber(value: number, digits = 2) {
  return new Intl.NumberFormat('zh-Hant-HK', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function formatCompact(value: number) {
  if (value >= 1_000_000_000) return `${formatNumber(value / 1_000_000_000, 2)}B`;
  if (value >= 1_000_000) return `${formatNumber(value / 1_000_000, 1)}M`;
  if (value >= 1_000) return `${formatNumber(value / 1_000, 1)}K`;
  return formatNumber(value, 0);
}

function formatDate(value: string, withYear = true) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-Hant-HK', {
    year: withYear ? 'numeric' : undefined,
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function formatTime(value: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-Hant-HK', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Asia/Hong_Kong',
  }).format(date);
}

// Z-score thresholds: ±1σ boundaries (covers ~68% of normal distribution)
function factorTone(value: number) {
  if (value > 1.0) return { label: '偏強', color: 'text-[#008c70]', bg: 'bg-[#e4f4ef]', bar: 'bg-[#0d9b7d]' };
  if (value < -1.0) return { label: '偏弱', color: 'text-[#c45243]', bg: 'bg-[#f9e8e5]', bar: 'bg-[#d26a59]' };
  return { label: '中性', color: 'text-[#9a6a13]', bg: 'bg-[#fff3d2]', bar: 'bg-[#d6a132]' };
}

function Chart({ data, mode, currency }: { data: FactorPoint[]; mode: ChartMode; currency: string }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const points = useMemo(() => {
    if (!data.length) return [];
    const values = data.map((point) => mode === 'momentum' ? point.close : point.volume);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    return data.map((point, index) => ({
      x: 18 + (index / Math.max(data.length - 1, 1)) * 564,
      y: 18 + (1 - ((values[index] - min) / range)) * 210,
      value: values[index],
      point,
    }));
  }, [data, mode]);

  const line = points.map((point) => `${point.x},${point.y}`).join(' ');
  const area = points.length ? `${line} 582,246 18,246` : '';
  const hovered = hoverIndex === null ? null : points[hoverIndex];

  return (
    <div className="relative mt-5 h-[260px] w-full" data-testid="chart-factor-history">
      <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-between text-[10px] font-medium tracking-[.08em] text-[#98a0aa]">
        <span>{mode === 'momentum' ? '價格（復權）' : '成交量'}</span>
        <span>{mode === 'momentum' ? currency : '股'}</span>
      </div>
      <svg
        className="absolute inset-0 h-full w-full overflow-visible pt-5"
        viewBox="0 0 600 270"
        preserveAspectRatio="none"
        role="img"
        aria-label={mode === 'momentum' ? '價格歷史走勢圖' : '成交量歷史走勢圖'}
        onMouseLeave={() => setHoverIndex(null)}
      >
        <defs>
          <linearGradient id={`area-${mode}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0d9b7d" stopOpacity=".22" />
            <stop offset="100%" stopColor="#0d9b7d" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((row) => (
          <line key={row} x1="18" x2="582" y1={18 + row * 70} y2={18 + row * 70} stroke="#e4e8eb" strokeDasharray="3 5" />
        ))}
        {area && <polygon points={area} fill={`url(#area-${mode})`} />}
        {line && <polyline points={line} fill="none" stroke="#087d68" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}
        {points.map((point, index) => (
          <g key={point.point.date}>
            <rect
              x={point.x - 7}
              y="8"
              width="14"
              height="242"
              fill="transparent"
              onMouseEnter={() => setHoverIndex(index)}
              data-testid={`chart-point-${index}`}
            />
            {hoverIndex === index && <circle cx={point.x} cy={point.y} r="4.5" fill="#f7fbf9" stroke="#087d68" strokeWidth="2.5" />}
          </g>
        ))}
      </svg>
      {hovered && (
        <div
          className="chart-tooltip pointer-events-none absolute z-10 min-w-[142px] rounded-lg border border-[#d9e4df] bg-[#fbfdfc] px-3 py-2 text-xs"
          style={{ left: `${Math.min(Math.max((hovered.x / 600) * 100, 14), 76)}%`, top: `${Math.max((hovered.y / 270) * 100 - 22, 4)}%` }}
          data-testid="chart-tooltip"
        >
          <div className="mb-1 font-mono text-[10px] text-[#7b858f]">{formatDate(hovered.point.date)}</div>
          <div className="font-semibold text-[#1d2a30]">{mode === 'momentum' ? currency : '成交量'}</div>
          <div className="font-mono text-sm text-[#087d68]">{mode === 'momentum' ? formatNumber(hovered.value) : formatCompact(hovered.value)}</div>
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-between font-mono text-[10px] text-[#98a0aa]">
        <span>{formatDate(data[0]?.date, false)}</span>
        <span>{formatDate(data[Math.floor(data.length / 2)]?.date, false)}</span>
        <span>{formatDate(data[data.length - 1]?.date, false)}</span>
      </div>
    </div>
  );
}

type FactorPoint = {
  date: string;
  close: number;
  volume: number;
  return: number | null;
  rstrZ: number | null;
  stomZ: number | null;
};

// ─── Factor Path Chart ──────────────────────────────────────────────────────
// Dual-line chart showing RSTR Z-score (orange) and STOM Z-score (green dashed)
// over time, matching Python Tab 3 "量化因子路徑".
function FactorPathChart({ data }: { data: FactorPoint[] }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  // Only include points that have at least one valid Z-score
  const validData = useMemo(
    () => data.filter((p) => p.rstrZ !== null || p.stomZ !== null),
    [data],
  );

  const { rstrPoints, stomPoints, zeroY } = useMemo(() => {
    if (!validData.length) return { rstrPoints: [], stomPoints: [], zeroY: 123 };
    const allZ = validData.flatMap((p) => [p.rstrZ, p.stomZ]).filter((v): v is number => v !== null);
    const minZ = Math.min(...allZ);
    const maxZ = Math.max(...allZ);
    const range = Math.max(maxZ - minZ, 0.5);
    const padded = range * 1.1;
    const domainMin = (minZ + maxZ) / 2 - padded / 2;
    const domainMax = (minZ + maxZ) / 2 + padded / 2;

    const toY = (z: number) => 18 + (1 - (z - domainMin) / (domainMax - domainMin)) * 210;
    const toX = (i: number) => 18 + (i / Math.max(validData.length - 1, 1)) * 564;

    const rstrPts = validData.map((p, i) => ({
      x: toX(i), y: p.rstrZ !== null ? toY(p.rstrZ) : null, rstrZ: p.rstrZ, stomZ: p.stomZ, date: p.date,
    }));
    const stomPts = validData.map((p, i) => ({
      x: toX(i), y: p.stomZ !== null ? toY(p.stomZ) : null,
    }));

    return { rstrPoints: rstrPts, stomPoints: stomPts, zeroY: toY(0) };
  }, [validData]);

  const rstrLine = rstrPoints.filter((p) => p.y !== null).map((p) => `${p.x},${p.y}`).join(' ');
  const stomLine = stomPoints.filter((p) => p.y !== null).map((p) => `${p.x},${p.y}`).join(' ');
  const hovered = hoverIndex === null ? null : rstrPoints[hoverIndex];

  if (!validData.length) {
    return <div className="flex h-[260px] items-center justify-center text-[12px] text-[#9ba5a7]">歷史資料不足，無法顯示因子路徑</div>;
  }

  return (
    <div className="relative mt-5 h-[260px] w-full" data-testid="chart-factor-path">
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-4 text-[10px] font-medium text-[#98a0aa]">
        <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-5 rounded-sm bg-[#d6904a]" />價格動能 RSTR</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-[2px] w-5 rounded-sm bg-[#159b7d]" style={{ borderTop: '2px dashed #159b7d', background: 'none' }} />交易流動性 STOM</span>
      </div>
      <svg
        className="absolute inset-0 h-full w-full overflow-visible pt-5"
        viewBox="0 0 600 270"
        preserveAspectRatio="none"
        role="img"
        aria-label="量化因子路徑圖"
        onMouseLeave={() => setHoverIndex(null)}
      >
        {/* Horizontal grid lines */}
        {[0, 1, 2, 3].map((row) => (
          <line key={row} x1="18" x2="582" y1={18 + row * 70} y2={18 + row * 70} stroke="#e4e8eb" strokeDasharray="3 5" />
        ))}
        {/* Zero baseline */}
        {zeroY >= 18 && zeroY <= 228 && (
          <line x1="18" x2="582" y1={zeroY} y2={zeroY} stroke="#e05a45" strokeWidth="1.5" strokeDasharray="4 4" opacity="0.65" />
        )}
        {/* STOM line (green dashed) */}
        {stomLine && <polyline points={stomLine} fill="none" stroke="#159b7d" strokeWidth="1.8" strokeDasharray="6 3" strokeLinejoin="round" strokeLinecap="round" />}
        {/* RSTR line (orange solid) */}
        {rstrLine && <polyline points={rstrLine} fill="none" stroke="#d6904a" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}
        {/* Hover regions */}
        {rstrPoints.map((point, index) => (
          <g key={validData[index].date}>
            <rect x={point.x - 7} y="8" width="14" height="242" fill="transparent" onMouseEnter={() => setHoverIndex(index)} />
            {hoverIndex === index && point.y !== null && <circle cx={point.x} cy={point.y} r="4.5" fill="#fff8f0" stroke="#d6904a" strokeWidth="2.5" />}
            {hoverIndex === index && stomPoints[index].y !== null && <circle cx={stomPoints[index].x} cy={stomPoints[index].y!} r="4" fill="#f0faf6" stroke="#159b7d" strokeWidth="2" />}
          </g>
        ))}
      </svg>
      {hovered && (
        <div
          className="pointer-events-none absolute z-10 min-w-[154px] rounded-lg border border-[#dde4e0] bg-[#fbfdfc] px-3 py-2 text-xs shadow-sm"
          style={{ left: `${Math.min(Math.max((hovered.x / 600) * 100, 14), 72)}%`, top: '8%' }}
        >
          <div className="mb-1.5 font-mono text-[10px] text-[#7b858f]">{formatDate(hovered.date)}</div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[10px] text-[#d6904a]">RSTR Z</span>
            <span className="font-mono text-[12px] font-semibold text-[#b5732e]">{hovered.rstrZ !== null ? (hovered.rstrZ >= 0 ? '+' : '') + formatNumber(hovered.rstrZ, 3) : '—'}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[10px] text-[#159b7d]">STOM Z</span>
            <span className="font-mono text-[12px] font-semibold text-[#0d7d65]">{hovered.stomZ !== null ? (hovered.stomZ >= 0 ? '+' : '') + formatNumber(hovered.stomZ, 3) : '—'}</span>
          </div>
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-between font-mono text-[10px] text-[#98a0aa]">
        <span>{formatDate(validData[0]?.date, false)}</span>
        <span className="text-[#e05a45] opacity-60">── 零軸</span>
        <span>{formatDate(validData[validData.length - 1]?.date, false)}</span>
      </div>
    </div>
  );
}

function LoadingWorkspace() {
  return (
    <div className="space-y-6" aria-label="正在載入分析資料" data-testid="loading-workspace">
      <div className="h-36 animate-pulse rounded-2xl bg-[#e5e9e9]" />
      <div className="grid gap-5 md:grid-cols-2">
        <div className="h-56 animate-pulse rounded-2xl bg-[#e5e9e9]" />
        <div className="h-56 animate-pulse rounded-2xl bg-[#e5e9e9]" />
      </div>
      <div className="h-80 animate-pulse rounded-2xl bg-[#e5e9e9]" />
    </div>
  );
}

function SideNavigation({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  return (
    <>
      {isOpen && <button className="fixed inset-0 z-30 bg-[#132129]/35 md:hidden" onClick={onClose} aria-label="關閉選單" data-testid="button-close-menu" />}
      <aside className={`fixed inset-y-0 left-0 z-40 flex w-[238px] flex-col bg-[#18252b] text-[#aebbc0] transition-transform duration-300 md:relative md:translate-x-0 ${isOpen ? 'translate-x-0' : '-translate-x-full'}`} data-testid="sidebar-navigation">
        <div className="flex h-[82px] items-center justify-between border-b border-[#2b3b40] px-6">
          <div className="flex items-center gap-3">
            <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-[#0d9b7d] text-[#f4fbf7]">
              <LineChart size={19} strokeWidth={2.5} />
              <span className="absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full bg-[#f7c95a]" />
            </div>
            <div>
              <div className="text-[15px] font-extrabold tracking-[-.03em] text-[#f2f7f5]">因子鏡</div>
              <div className="font-mono text-[9px] uppercase tracking-[.18em] text-[#708187]">市場研究</div>
            </div>
          </div>
          <button className="rounded-md p-1 text-[#819196] hover:bg-[#22343a] md:hidden" onClick={onClose} aria-label="關閉選單" data-testid="button-close-sidebar"><X size={17} /></button>
        </div>
        <div className="px-3 py-6">
          <div className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[.16em] text-[#65777d]">工作台</div>
          <button className="flex w-full items-center gap-3 rounded-lg bg-[#26383e] px-3 py-3 text-left text-[13px] font-semibold text-[#f1f7f3]" onClick={onClose} data-testid="button-nav-analysis">
            <Gauge size={17} className="text-[#41c5a7]" /> 因子分析
            <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#f7c95a]" />
          </button>
          <button className="mt-1 flex w-full cursor-not-allowed items-center gap-3 rounded-lg px-3 py-3 text-left text-[13px] text-[#66777c]" disabled data-testid="button-nav-watchlist">
            <Activity size={17} /> 觀察清單 <span className="ml-auto font-mono text-[10px] text-[#687b81]">即將推出</span>
          </button>
        </div>
        <div className="mt-auto border-t border-[#2b3b40] px-6 py-5">
          <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold text-[#8da0a5]"><Database size={14} className="text-[#41c5a7]" /> 數據來源</div>
          <p className="text-[11px] leading-5 text-[#667b82]">Yahoo Finance · 每日收市資料<br />自動更新，僅供研究參考</p>
          <div className="mt-5 flex items-center gap-2 font-mono text-[9px] tracking-[.12em] text-[#61747a]"><span className="h-1.5 w-1.5 rounded-full bg-[#3ab999]" /> 系統運作正常</div>
        </div>
      </aside>
    </>
  );
}

function FactorCard({ label, code, value, description, window, icon: Icon }: { label: string; code: string; value: number; description: string; window: string; icon: typeof TrendingUp }) {
  const tone = factorTone(value);
  // Z-scores typically range ±3σ; map |Z|=3 → 100% bar width
  const width = Math.min((Math.abs(value) / 3) * 100, 100);
  return (
    <section className="animate-rise-in animate-rise-in-delay-1 rounded-2xl border border-[#dfe5e4] bg-[#fbfdfc] p-5 shadow-[0_4px_18px_rgba(24,48,52,.035)]" data-testid={`card-factor-${code.toLowerCase()}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#e8f4f0] text-[#07876d]"><Icon size={18} /></div>
          <div>
            <div className="flex items-center gap-2 text-[14px] font-bold text-[#23343a]">{label}<span className="font-mono text-[10px] font-medium tracking-[.1em] text-[#8a9599]">{code}</span></div>
            <div className="mt-1 text-[11px] text-[#829095]">{description}</div>
          </div>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${tone.bg} ${tone.color}`} data-testid={`status-factor-${code.toLowerCase()}`}>{tone.label}</span>
      </div>
      <div className="mt-6 flex items-end justify-between">
        <div className={`font-mono text-[34px] font-medium tracking-[-.06em] ${tone.color}`} data-testid={`value-factor-${code.toLowerCase()}`}>{value >= 0 ? '+' : ''}{formatNumber(value, 4)}</div>
        <div className="mb-2 flex items-center gap-1 text-[10px] text-[#899499]"><CalendarDays size={12} /> {window}</div>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#edf0ef]">
        <div className={`h-full rounded-full transition-all duration-700 ${tone.bar}`} style={{ width: `${width}%` }} />
      </div>
      <div className="mt-2 flex justify-between text-[9px] font-medium text-[#a1aaad]"><span>弱</span><span>基準 0</span><span>強</span></div>
    </section>
  );
}

function AnalysisNote({ title, children, tone = 'neutral' }: { title: string; children: ReactNode; tone?: 'neutral' | 'positive' | 'caution' | 'risk' }) {
  const styles = {
    neutral: { border: 'border-[#dce7e3]', bg: 'bg-[#f4f9f7]', label: 'text-[#52736c]' },
    positive: { border: 'border-[#c9e6da]', bg: 'bg-[#f0faf5]', label: 'text-[#087d68]' },
    caution: { border: 'border-[#eadfbd]', bg: 'bg-[#fffaf0]', label: 'text-[#9a6a13]' },
    risk: { border: 'border-[#f0d3ce]', bg: 'bg-[#fff8f6]', label: 'text-[#b04d40]' },
  }[tone];

  return (
    <div className={`mt-4 rounded-xl border ${styles.border} ${styles.bg} px-3.5 py-3`} data-testid={`analysis-note-${title}`}>
      <div className={`mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[.12em] ${styles.label}`}>
        <CircleHelp size={12} /> 專業分析 · {title}
      </div>
      <p className="text-[11px] leading-5 text-[#637477]">{children}</p>
    </div>
  );
}

function getMomentumAnalysis(value: number) {
  if (value <= -2) return { tone: 'risk' as const, text: 'RSTR 低於 -2σ，代表相對自身歷史分布出現顯著弱勢。中期價格趨勢仍受壓，任何反彈更適合先視為修復性反彈，需觀察是否能重新站回零軸。' };
  if (value < -1) return { tone: 'caution' as const, text: 'RSTR 低於 -1σ，價格動能明顯落後於自身歷史常態。趨勢偏弱但尚未達到極端區域，短線反彈的持續性仍需由後續動能改善確認。' };
  if (value >= 1) return { tone: 'positive' as const, text: 'RSTR 高於 +1σ，代表中期價格動能顯著強於自身歷史常態。趨勢結構偏正面，但高位仍要留意動能鈍化與均值回歸風險。' };
  if (value >= 0) return { tone: 'positive' as const, text: 'RSTR 位於零軸上方，價格動能較自身歷史均值偏強。現階段屬溫和正向，尚不足以單獨判定趨勢已進入加速階段。' };
  return { tone: 'caution' as const, text: 'RSTR 位於零軸下方，表示中期動能仍偏弱。若價格出現反彈，需配合 RSTR 回升並突破零軸，才可提高趨勢反轉的可信度。' };
}

function getLiquidityAnalysis(value: number) {
  if (value >= 2) return { tone: 'caution' as const, text: 'STOM 高於 +2σ，成交活躍度已處於歷史極端高位。高流動性不等於淨買入；若價格未同步上行，需警惕高位換手、事件驅動或供給增加。' };
  if (value >= 1) return { tone: 'positive' as const, text: 'STOM 高於 +1σ，市場參與度及成交承接明顯高於歷史常態。這有助於交易執行，但仍需配合價格方向判斷流動性是吸收還是派發。' };
  if (value <= -1) return { tone: 'caution' as const, text: 'STOM 低於 -1σ，成交活躍度低於歷史常態。低流動性可能放大買賣價差與價格衝擊，任何突破訊號都應等待成交量確認。' };
  return { tone: 'neutral' as const, text: 'STOM 接近歷史常態，暫未顯示極端放量或明顯流動性收縮。單憑成交活躍度不足以建立方向性判斷，應與 RSTR 及價格路徑合併分析。' };
}

function getPriceAnalysis(data: { series: FactorPoint[] }) {
  const latest = data.series[data.series.length - 1];
  const dayReturn = latest?.return ?? null;
  const returnText = dayReturn === null
    ? '最新一期回報資料不足'
    : dayReturn > 0.02
      ? `最新一期上升 ${(dayReturn * 100).toFixed(2)}%，短線買盤明顯，但單日變動不代表中期趨勢已確認。`
      : dayReturn < -0.02
        ? `最新一期下跌 ${(Math.abs(dayReturn) * 100).toFixed(2)}%，短線賣壓較重，需觀察是否伴隨成交活躍度上升。`
        : `最新一期變動 ${(dayReturn * 100).toFixed(2)}%，短線價格處於相對平穩狀態。`;
  return { latest, text: returnText };
}

function EmptyState() {
  return (
    <div className="hairline-grid flex min-h-[480px] items-center justify-center rounded-2xl border border-dashed border-[#cbd8d5] bg-[#f7fbf9] p-8 text-center" data-testid="empty-workspace">
      <div className="max-w-sm">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#dff1eb] text-[#07876d]"><Sparkles size={24} /></div>
        <h2 className="text-xl font-extrabold tracking-[-.04em] text-[#213238]">輸入代號，開始拆解</h2>
        <p className="mt-2 text-sm leading-6 text-[#768589]">我們會從約 28 個月的每日價格與成交量，計算一組可追溯的動能與流動性讀數。</p>
      </div>
    </div>
  );
}

function pct(value: number) {
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%`;
}

function BacktestPanel({ data, isLoading, isError, onRetry }: { data?: HistoricalBacktest; isLoading: boolean; isError: boolean; onRetry: () => void }) {
  if (isLoading) {
    return <section className="rounded-2xl border border-[#dfe5e4] bg-[#fbfdfc] p-6" data-testid="backtest-loading"><div className="h-5 w-48 animate-pulse rounded bg-[#e5e9e9]" /><div className="mt-5 grid gap-4 md:grid-cols-3">{[1, 2, 3].map((item) => <div key={item} className="h-32 animate-pulse rounded-xl bg-[#eef2f0]" />)}</div></section>;
  }
  if (isError) {
    return <section className="rounded-2xl border border-[#ecd0ca] bg-[#fffaf9] p-6" data-testid="backtest-error"><div className="font-bold text-[#b04d40]">历史回测暂时无法完成</div><p className="mt-2 text-[11px] leading-5 text-[#8c7d7a]">可能是 EOD 历史资料不足或数据源暂时不可用，请稍后重试。</p><button onClick={onRetry} className="mt-4 rounded-lg bg-[#23383c] px-4 py-2 text-xs font-bold text-white">重新回测</button></section>;
  }
  if (!data) return null;
  return (
    <section className="animate-rise-in rounded-2xl border border-[#dfe5e4] bg-[#fbfdfc] p-5 shadow-[0_4px_18px_rgba(24,48,52,.035)] md:p-6" data-testid="card-historical-backtest">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
        <div><div className="flex items-center gap-2"><Activity size={16} className="text-[#07876d]" /><h2 className="text-[15px] font-extrabold text-[#26373c]">历史回测</h2><span className="rounded bg-[#e9f4f0] px-1.5 py-0.5 text-[9px] font-bold text-[#07876d]">EOD</span></div><p className="mt-1 text-[11px] text-[#899599]">{data.startDate} — {data.endDate} · {data.source}</p></div>
        <div className="rounded-lg bg-[#f0f8f5] px-3 py-2 text-right"><div className="text-[10px] text-[#78918d]">有效信号</div><div className="font-mono text-lg font-semibold text-[#087d68]">{data.totalSignals}</div></div>
      </div>
      <div className="mt-4 rounded-xl border border-[#dce7e3] bg-[#f4f9f7] px-3.5 py-3 text-[11px] leading-5 text-[#637477]"><span className="font-bold text-[#52736c]">信号定义：</span>{data.signalDefinition}<br /><span className="font-bold text-[#52736c]">执行规则：</span>{data.executionRule}</div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 rounded-xl border border-[#e2e9e6] bg-white px-3.5 py-2.5 font-mono text-[10px] text-[#637477]" data-testid="backtest-parameters">
        <span>RSTR 阈值 {data.parameters.rstrThreshold > 0 ? '+' : ''}{data.parameters.rstrThreshold.toFixed(2)}σ</span>
        <span>STOM 阈值 {data.parameters.stomThreshold > 0 ? '+' : ''}{data.parameters.stomThreshold.toFixed(2)}σ</span>
        <span>持有期 {data.parameters.shortDays} / {data.parameters.mediumDays} / {data.parameters.longDays} 日</span>
      </div>
      <div className="mt-5 grid gap-4 md:grid-cols-3">
        {data.trends.map((trend) => <div key={trend.label} className="rounded-xl border border-[#e2e9e6] bg-white p-4" data-testid={`backtest-trend-${trend.tradingDays}`}><div className="flex items-center justify-between"><span className="text-xs font-bold text-[#33474c]">{trend.label}趋势</span><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${trend.direction === '上升' ? 'bg-[#e4f4ef] text-[#087d68]' : trend.direction === '下降' ? 'bg-[#f9e8e5] text-[#c45243]' : 'bg-[#fff3d2] text-[#9a6a13]'}`}>{trend.direction}</span></div><div className="mt-3 font-mono text-xl text-[#2d4146]">{pct(trend.return)}</div><div className="mt-1 text-[10px] text-[#899599]">年化估算 {pct(trend.annualizedReturn)}</div><p className="mt-3 text-[11px] leading-5 text-[#637477]">{trend.analysis}</p></div>)}
      </div>
       <div className="mt-6 overflow-x-auto"><table className="w-full min-w-[760px] text-left text-[11px]"><thead><tr className="border-b border-[#e2e9e6] text-[#899599]"><th className="px-3 py-2 font-semibold">持有周期</th><th className="px-3 py-2 font-semibold">完成样本</th><th className="px-3 py-2 font-semibold">毛命中率</th><th className="px-3 py-2 font-semibold">净命中率</th><th className="px-3 py-2 font-semibold">毛平均收益</th><th className="px-3 py-2 font-semibold">净平均收益</th></tr></thead><tbody>{data.periods.map((period) => <tr key={period.label} className="border-b border-[#eef2f0]" data-testid={`backtest-period-${period.tradingDays}`}><td className="px-3 py-3 font-bold text-[#33474c]">{period.label} · {period.tradingDays}日</td><td className="px-3 py-3 font-mono text-[#52676a]">{period.completedSamples}</td><td className="px-3 py-3 font-mono text-[#52676a]">{(period.hitRate * 100).toFixed(1)}%</td><td className={`px-3 py-3 font-mono font-bold ${period.netHitRate >= period.hitRate ? 'text-[#087d68]' : 'text-[#c45243]'}`}>{(period.netHitRate * 100).toFixed(1)}%</td><td className={`px-3 py-3 font-mono ${period.averageReturn >= 0 ? 'text-[#087d68]' : 'text-[#c45243]'}`}>{pct(period.averageReturn)}</td><td className={`px-3 py-3 font-mono font-bold ${period.netAverageReturn >= 0 ? 'text-[#087d68]' : 'text-[#c45243]'}`}>{pct(period.netAverageReturn)}</td></tr>)}</tbody></table></div>
       <div className="mt-6 rounded-xl border border-[#dce7e3] bg-[#f4f9f7] p-4" data-testid="card-cost-sensitivity">
         <div className="flex flex-col justify-between gap-2 md:flex-row md:items-center"><div><div className="text-[10px] font-bold uppercase tracking-[.12em] text-[#52736c]">成本敏感性</div><p className="mt-1 text-[11px] text-[#637477]">以下均为进出场双边成本；毛收益不扣成本，净收益已扣除手续费与滑点。</p></div><span className="rounded-full bg-white px-2.5 py-1 font-mono text-[10px] font-bold text-[#087d68]">当前 {data.costAssumptions.totalRoundTripBps.toFixed(0)} bps</span></div>
         <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[620px] text-left text-[10px]"><thead><tr className="border-b border-[#dce7e3] text-[#78918d]"><th className="px-2 py-2 font-semibold">手续费 / 滑点（单边）</th><th className="px-2 py-2 font-semibold">双边成本</th>{data.periods.map((period) => <th key={period.label} className="px-2 py-2 font-semibold">{period.label}净收益</th>)}</tr></thead><tbody>{data.costScenarios.map((scenario) => <tr key={`${scenario.feeBps}-${scenario.slippageBps}`} className={`border-b border-[#e5eeea] ${scenario.feeBps === data.costAssumptions.feeBps && scenario.slippageBps === data.costAssumptions.slippageBps ? 'bg-white font-bold' : ''}`}><td className="px-2 py-2 font-mono text-[#52676a]">{scenario.feeBps} / {scenario.slippageBps} bps</td><td className="px-2 py-2 font-mono text-[#52676a]">{scenario.totalRoundTripBps} bps</td>{scenario.periods.map((period) => <td key={period.label} className={`px-2 py-2 font-mono ${period.netAverageReturn >= 0 ? 'text-[#087d68]' : 'text-[#c45243]'}`}>{pct(period.netAverageReturn)} · {(period.netHitRate * 100).toFixed(1)}%</td>)}</tr>)}</tbody></table></div>
       </div>
       <div className="mt-5"><div className="flex flex-wrap items-baseline justify-between gap-2"><div className="text-[10px] font-bold uppercase tracking-[.12em] text-[#52736c]">最近触发信号</div><div className="font-mono text-[10px] text-[#899599]">行情截至 {data.endDate}</div></div><p className="mt-1 text-[10px] text-[#899599]">此处日期是最近一次满足双因子条件的信号，并非最新行情日期。</p>{data.recentSignals.length ? <div className="mt-2 grid gap-2 md:grid-cols-2">{data.recentSignals.slice(0, 6).map((signal) => <div key={signal.signalDate} className="flex items-center justify-between rounded-lg border border-[#e6ece9] px-3 py-2 text-[10px]"><div><span className="font-mono text-[#52676a]">{signal.signalDate}</span><span className="ml-2 text-[#899599]">次日执行 {signal.executionDate}</span></div><div className="font-mono text-[#087d68]">RSTR {signal.rstrZ.toFixed(2)} · STOM {signal.stomZ.toFixed(2)}</div></div>)}</div> : <p className="mt-2 text-[11px] text-[#899599]">在当前历史区间没有符合双因子确认条件的信号。</p>}</div>
       <p className="mt-5 border-t border-[#e7ecea] pt-4 text-[10px] leading-5 text-[#899599]">统计为历史样本结果，仅按上述手续费与滑点假设扣除，未包含税费或流动性冲击；历史回测不代表未来收益，也不构成投资建议。</p>
    </section>
  );
}

export default function Home() {
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [inputTicker, setInputTicker] = useState('0700.HK');
  const [ticker, setTicker] = useState('0700.HK');
  const [chartMode, setChartMode] = useState<ChartMode>('momentum');
  const [methodHelpOpen, setMethodHelpOpen] = useState(false);
  const [backtestRequested, setBacktestRequested] = useState(false);
  const [feeBps, setFeeBps] = useState(10);
  const [slippageBps, setSlippageBps] = useState(5);
  const [rstrThreshold, setRstrThreshold] = useState(0);
  const [stomThreshold, setStomThreshold] = useState(0);
  const [shortDays, setShortDays] = useState(21);
  const [mediumDays, setMediumDays] = useState(63);
  const [longDays, setLongDays] = useState(252);
  const { data, isLoading, isFetching, isError, error, refetch } = useGetFactorAnalysis(ticker, {
    query: {
      queryKey: getGetFactorAnalysisQueryKey(ticker),
      enabled: Boolean(ticker),
      refetchInterval: DATA_REFRESH_INTERVAL_MS,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  });
  const {
    data: hsiSnapshot,
    isFetching: isHsiFetching,
    isError: isHsiError,
    refetch: refetchHsi,
  } = useGetRealtimeMarketData('^HSI', {
    query: {
      queryKey: getGetRealtimeMarketDataQueryKey('^HSI'),
      refetchInterval: REALTIME_REFRESH_INTERVAL_MS,
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  });
  const hsiHistoryQuery = useGetMarketHistory('^HSI', { days: 30 }, {
    query: {
      queryKey: getGetMarketHistoryQueryKey('^HSI', { days: 30 }),
      staleTime: 60_000,
      refetchInterval: DATA_REFRESH_INTERVAL_MS,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  });
  const hsiQualityQuery = useGetHsiQualityPicks({
    query: {
      queryKey: getGetHsiQualityPicksQueryKey(),
      staleTime: 5 * 60_000,
      refetchInterval: DATA_REFRESH_INTERVAL_MS,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  });
  const hsiLaggardsQuery = useGetHsiQualityLaggards({
    query: {
      queryKey: getGetHsiQualityLaggardsQueryKey(),
      staleTime: 5 * 60_000,
      refetchInterval: DATA_REFRESH_INTERVAL_MS,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  });
  const hsiRecoveryQuery = useGetHsiRecoveryPicks({
    query: {
      queryKey: getGetHsiRecoveryPicksQueryKey(),
      staleTime: 5 * 60_000,
      refetchInterval: DATA_REFRESH_INTERVAL_MS,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  });
  const hsiLeaderQuery = useGetHsiLeaderPicks({
    query: {
      queryKey: getGetHsiLeaderPicksQueryKey(),
      staleTime: 5 * 60_000,
      refetchInterval: DATA_REFRESH_INTERVAL_MS,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  });
  const hsiLeaderPullbackQuery = useGetHsiLeaderPullbackPicks({
    query: {
      queryKey: getGetHsiLeaderPullbackPicksQueryKey(),
      staleTime: 5 * 60_000,
      refetchInterval: DATA_REFRESH_INTERVAL_MS,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  });
  const hsiMoversQuery = useGetHsiMovers({
    query: {
      queryKey: getGetHsiMoversQueryKey(),
      staleTime: DATA_REFRESH_INTERVAL_MS,
      refetchInterval: DATA_REFRESH_INTERVAL_MS,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  });
  const valuationQuery = useGetValuationAssessment(ticker, {
    query: {
      queryKey: getGetValuationAssessmentQueryKey(ticker),
      enabled: Boolean(ticker),
      staleTime: VALUATION_REFRESH_INTERVAL_MS,
      refetchInterval: VALUATION_REFRESH_INTERVAL_MS,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  });
  const hsiValuationQuery = useGetHsiValuationPicks({
    query: {
      queryKey: getGetHsiValuationPicksQueryKey(),
      staleTime: VALUATION_REFRESH_INTERVAL_MS,
      refetchInterval: VALUATION_REFRESH_INTERVAL_MS,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  });
  const hsiValueRecoveryQuery = useGetHsiValueRecoveryPicks({
    query: {
      queryKey: getGetHsiValueRecoveryPicksQueryKey(),
      staleTime: VALUATION_REFRESH_INTERVAL_MS,
      refetchInterval: VALUATION_REFRESH_INTERVAL_MS,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  });
  const backtestParams: GetHistoricalBacktestParams = { feeBps, slippageBps, rstrThreshold, stomThreshold, shortDays, mediumDays, longDays };
  const backtestQuery = useGetHistoricalBacktest(ticker, backtestParams, {
    query: {
      queryKey: getGetHistoricalBacktestQueryKey(ticker, backtestParams),
      enabled: backtestRequested,
      refetchInterval: DATA_REFRESH_INTERVAL_MS,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  });
  const isRefreshing = isFetching
    || isHsiFetching
    || hsiHistoryQuery.isFetching
    || hsiQualityQuery.isFetching
    || hsiLaggardsQuery.isFetching
    || hsiRecoveryQuery.isFetching
    || hsiLeaderQuery.isFetching
    || hsiLeaderPullbackQuery.isFetching
    || hsiMoversQuery.isFetching
    || valuationQuery.isFetching
    || hsiValuationQuery.isFetching
    || hsiValueRecoveryQuery.isFetching
    || (backtestRequested && backtestQuery.isFetching);

  const submitTicker = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextTicker = normalizeTickerInput(inputTicker);
    if (nextTicker) {
      setTicker(nextTicker);
      if (isMobile) setSidebarOpen(false);
    }
  };

  const factorData = data?.series ?? [];
  const errorMessage = error instanceof Error ? error.message : '暫時無法取得這個代號的市場資料。';
  const momentumAnalysis = data ? getMomentumAnalysis(data.momentum) : null;
  const liquidityAnalysis = data ? getLiquidityAnalysis(data.liquidity) : null;
  const priceAnalysis = data ? getPriceAnalysis(data) : null;
  const factorRelationship = data
    ? data.momentum >= 0 && data.liquidity >= 0
      ? { tone: 'positive' as const, text: 'RSTR 與 STOM 同時位於零軸上方，呈現價格動能與成交活躍度同向改善的結構；若後續兩者同步維持，趨勢延續的可信度較高。' }
      : data.momentum < 0 && data.liquidity < 0
        ? { tone: 'caution' as const, text: 'RSTR 與 STOM 同時位於零軸下方，價格動能和成交活躍度均偏弱。市場可能處於缺乏承接的弱勢階段，應降低對單一反彈訊號的信任。' }
        : data.divergenceAlert
          ? { tone: 'risk' as const, text: '兩因子出現明顯背離：成交活躍度極高，但中期價格動能為負。這是高位換手或供給增加的典型風險組合，必須等待價格與 RSTR 同步修復。' }
          : { tone: 'neutral' as const, text: 'RSTR 與 STOM 方向不一致，市場正處於動能與交易活躍度重新定價階段。建議等待兩個因子重新同向，避免只依賴單一指標追價。' }
    : null;

  const downloadSummary = () => {
    if (!data) return;
    const rows = [
      ['因子鏡分析摘要', data.ticker],
      ['公司名稱', data.name],
      ['資料區間', `${data.startDate} — ${data.endDate}`],
      ['最新收市價', String(data.latestClose)],
      ['價格動能 RSTR', String(data.momentum)],
      ['交易流動性 STOM', String(data.liquidity)],
      ['擁擠度風險代理', data.crowdingRiskLevel],
      ['擁擠度代理分數', String(data.crowdingScore)],
      ['擁擠度觸發依據', data.crowdingDrivers.join('；') || '無'],
      ['平均成交量', String(data.averageVolume)],
      ['成交金額代理', String(data.averageTurnoverProxy)],
    ];
    const blob = new Blob([rows.map((row) => row.join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${data.ticker}-factor-analysis.csv`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="app-grain flex min-h-[100dvh] bg-[#eef1f1] font-sans text-[#213238]">
      <SideNavigation isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="min-w-0 flex-1">
        <header className="sticky top-0 z-20 border-b border-[#dfe5e4] bg-[#f7f9f8]/95 backdrop-blur-md">
          <div className="flex h-[82px] items-center justify-between px-5 md:px-8 lg:px-11">
            <div className="flex items-center gap-3">
              <button className="rounded-lg p-2 text-[#4d6066] hover:bg-[#e6ecea] md:hidden" onClick={() => setSidebarOpen(true)} aria-label="開啟選單" data-testid="button-open-menu"><Menu size={20} /></button>
              <div className="hidden h-8 w-px bg-[#dbe3e0] md:block" />
              <div>
                <div className="font-mono text-[10px] font-medium uppercase tracking-[.15em] text-[#839095]">因子工作台 / 研究視圖</div>
                <h1 className="mt-1 text-[15px] font-bold tracking-[-.02em] text-[#25353b]">Barra 雙因子分析</h1>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden items-center gap-3 rounded-xl border border-[#d8e1de] bg-[#fbfdfc] px-3 py-1.5 sm:flex" data-testid="card-hsi-realtime">
                <div className="border-r border-[#e0e6e4] pr-3">
                  <div className="text-[10px] font-bold text-[#53676b]">恆生指數</div>
                  <div className="font-mono text-[9px] text-[#91a0a1]">^HSI</div>
                </div>
                <div className="min-w-[108px]">
                  <div className={`font-mono text-[15px] font-semibold tracking-[-.04em] ${hsiSnapshot ? 'text-[#087d68]' : 'text-[#849294]'}`}>
                    {hsiSnapshot ? formatNumber(hsiSnapshot.latestPrice, 2) : '—'}
                  </div>
                  <div className="mt-0.5 flex items-center gap-1 text-[9px] text-[#879596]">
                    <span className={`h-1.5 w-1.5 rounded-full ${isHsiFetching ? 'animate-pulse bg-[#d6a132]' : hsiSnapshot ? 'bg-[#159b7d]' : 'bg-[#c45243]'}`} />
                    {isHsiError ? '暫無更新' : hsiSnapshot?.isIntraday ? `盤中 · ${formatTime(hsiSnapshot.updatedAt)}` : hsiSnapshot ? `最近收市 · ${formatTime(hsiSnapshot.updatedAt)}` : '讀取中'}
                  </div>
                </div>
              </div>
               <div className="hidden items-center gap-2 text-[11px] text-[#7d8c90] sm:flex"><span className={`h-1.5 w-1.5 rounded-full ${isRefreshing ? 'animate-pulse bg-[#d6a132]' : 'bg-[#159b7d]'}`} />{isRefreshing ? '同步中' : '資料已同步'}</div>
                <button className="flex h-9 items-center gap-2 rounded-lg border border-[#d8e1de] bg-[#fbfdfc] px-3 text-[11px] font-semibold text-[#52646a] transition-colors hover:border-[#a4c9be] hover:text-[#087d68]" onClick={() => { void Promise.all([refetch(), refetchHsi(), hsiHistoryQuery.refetch(), hsiQualityQuery.refetch(), hsiLaggardsQuery.refetch(), hsiRecoveryQuery.refetch(), hsiLeaderQuery.refetch(), hsiLeaderPullbackQuery.refetch(), hsiMoversQuery.refetch(), valuationQuery.refetch(), hsiValuationQuery.refetch(), hsiValueRecoveryQuery.refetch(), ...(backtestRequested ? [backtestQuery.refetch()] : [])]); }} disabled={isRefreshing} data-testid="button-refresh-data"><RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} /> <span className="hidden sm:inline">重新整理</span></button>
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-[1410px] px-5 py-7 md:px-8 md:py-9 lg:px-11">
          <section className="animate-rise-in relative overflow-hidden rounded-2xl bg-[#203238] px-6 py-7 text-[#eff7f4] shadow-[0_10px_30px_rgba(28,53,57,.12)] md:px-9 md:py-8">
            <div className="pointer-events-none absolute -right-10 -top-28 h-72 w-72 rounded-full border-[40px] border-[#2f4d4e]/55" />
            <div className="pointer-events-none absolute -bottom-24 right-40 h-52 w-52 rounded-full border-[26px] border-[#2a4648]/45" />
            <div className="relative">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.18em] text-[#75cdb6]"><span className="h-1.5 w-1.5 rounded-full bg-[#f7c95a]" /> 即時研究快照</div>
                  <h2 className="mt-3 max-w-xl text-[27px] font-extrabold leading-[1.15] tracking-[-.055em] md:text-[34px]">從一個代號，得到<br className="hidden sm:block" />一個可解釋的因子讀數。</h2>
                  <p className="mt-3 max-w-lg text-[12px] leading-5 text-[#a9bdbb]">以價格動能與交易流動性兩個維度，快速建立你的第一個市場假設。</p>
                </div>
                <div className="hidden rounded-lg border border-[#42605c] bg-[#294248] px-3 py-2 text-right md:block">
                  <div className="font-mono text-[9px] uppercase tracking-[.15em] text-[#7ba59e]">分析週期</div>
                  <div className="mt-1 font-mono text-[12px] text-[#d4e8e2]">約 28 個月 · 日線</div>
                </div>
              </div>
              <form onSubmit={submitTicker} className="mt-7 flex max-w-[600px] flex-col gap-2 sm:flex-row" data-testid="form-ticker-search">
                <label className="relative flex-1">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[#72938f]" size={17} />
                  <input value={inputTicker} onChange={(event) => setInputTicker(event.target.value)} className="h-12 w-full rounded-xl border border-[#496260] bg-[#17282e] pl-11 pr-4 font-mono text-[14px] uppercase tracking-[.04em] text-[#eef8f4] outline-none transition-colors placeholder:text-[#6f8585] focus:border-[#61cdb2] focus:ring-2 focus:ring-[#61cdb2]/20" placeholder="輸入代號，例如 HSI、700、0700.HK" aria-label="股票代號" data-testid="input-ticker" />
                </label>
                <button className="flex h-12 items-center justify-center gap-2 rounded-xl bg-[#f2c75b] px-6 text-[13px] font-extrabold text-[#243238] transition-transform hover:-translate-y-0.5 hover:bg-[#ffd36d] active:translate-y-0" type="submit" data-testid="button-analyze"><span>分析代號</span><ArrowUpRight size={16} /></button>
              </form>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] text-[#78918d]">
                <span>熱門：</span>
                {popularTickers.map((popularTicker) => (
                  <button key={popularTicker} className="rounded-md border border-[#3f5958] px-2 py-1 font-mono text-[#a6c5bd] transition-colors hover:border-[#69cdb4] hover:text-[#d8eee7]" onClick={() => { setInputTicker(popularTicker); setTicker(normalizeTickerInput(popularTicker)); }} data-testid={`button-ticker-${popularTicker.replace('.', '-')}`}>{popularTicker}</button>
                ))}
              </div>
            </div>
          </section>

          <div className="mt-7">
            <HsiHistoryPanel
              data={hsiHistoryQuery.data}
               liveSnapshot={hsiSnapshot}
               isLiveFetching={isHsiFetching}
               isLiveError={isHsiError}
              isLoading={hsiHistoryQuery.isLoading}
              isError={hsiHistoryQuery.isError}
              onRetry={() => { void hsiHistoryQuery.refetch(); }}
            />
          </div>

          <div className="mt-7">
            <HsiStockFinder
              movers={hsiMoversQuery.data}
              leaders={hsiLeaderQuery.data}
              laggards={hsiLaggardsQuery.data}
              isLoading={hsiMoversQuery.isLoading || hsiLeaderQuery.isLoading || hsiLaggardsQuery.isLoading}
              isError={hsiMoversQuery.isError || hsiLeaderQuery.isError || hsiLaggardsQuery.isError}
              onRetry={() => { void Promise.all([hsiMoversQuery.refetch(), hsiLeaderQuery.refetch(), hsiLaggardsQuery.refetch()]); }}
              onSelectTicker={(selectedTicker) => { setInputTicker(selectedTicker); setTicker(selectedTicker); }}
            />
          </div>

           <div className="mt-7">
             <HsiValuationPicks
               data={hsiValuationQuery.data}
               isLoading={hsiValuationQuery.isLoading}
               isError={hsiValuationQuery.isError}
               onRetry={() => { void hsiValuationQuery.refetch(); }}
               onSelectTicker={(selectedTicker) => { setInputTicker(selectedTicker); setTicker(selectedTicker); }}
             />
           </div>

           <div className="mt-7">
             <HsiValueRecoveryPicks
               data={hsiValueRecoveryQuery.data}
               isLoading={hsiValueRecoveryQuery.isLoading}
               isError={hsiValueRecoveryQuery.isError}
               onRetry={() => { void hsiValueRecoveryQuery.refetch(); }}
               onSelectTicker={(selectedTicker) => { setInputTicker(selectedTicker); setTicker(selectedTicker); }}
             />
           </div>

          <div className="mt-7">
            <HsiQualityPicks
              data={hsiQualityQuery.data}
              isLoading={hsiQualityQuery.isLoading}
              isError={hsiQualityQuery.isError}
              onRetry={() => { void hsiQualityQuery.refetch(); }}
            />
          </div>

          <div className="mt-7">
            <HsiQualityPicks
              data={hsiLaggardsQuery.data}
              isLoading={hsiLaggardsQuery.isLoading}
              isError={hsiLaggardsQuery.isError}
              onRetry={() => { void hsiLaggardsQuery.refetch(); }}
              mode="laggard"
            />
          </div>

          <div className="mt-7">
            <HsiQualityPicks
              data={hsiRecoveryQuery.data}
              isLoading={hsiRecoveryQuery.isLoading}
              isError={hsiRecoveryQuery.isError}
              onRetry={() => { void hsiRecoveryQuery.refetch(); }}
              mode="recovery"
            />
          </div>

          <div className="mt-7">
            <HsiQualityPicks
              data={hsiLeaderQuery.data}
              isLoading={hsiLeaderQuery.isLoading}
              isError={hsiLeaderQuery.isError}
              onRetry={() => { void hsiLeaderQuery.refetch(); }}
              mode="leader"
            />
          </div>

          <div className="mt-7">
            <HsiQualityPicks
              data={hsiLeaderPullbackQuery.data}
              isLoading={hsiLeaderPullbackQuery.isLoading}
              isError={hsiLeaderPullbackQuery.isError}
              onRetry={() => { void hsiLeaderPullbackQuery.refetch(); }}
              mode="pullback"
            />
          </div>

          <div className="mt-7">
            {isLoading ? <LoadingWorkspace /> : isError ? (
              <section className="flex min-h-[420px] items-center justify-center rounded-2xl border border-[#ecd0ca] bg-[#fffaf9] px-6 text-center" data-testid="error-workspace">
                <div className="max-w-md">
                  <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f9e8e5] text-[#c45243]"><CircleHelp size={25} /></div>
                  <div className="font-mono text-[11px] uppercase tracking-[.14em] text-[#c45243]">資料讀取失敗 · {ticker}</div>
                  <h2 className="mt-3 text-xl font-extrabold tracking-[-.04em] text-[#3b3535]">這個代號暫時沒有可用資料</h2>
                  <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-[#8c7d7a]">{errorMessage}</p>
                  <div className="mt-6 flex flex-wrap justify-center gap-2">
                    <button className="flex items-center gap-2 rounded-lg bg-[#23383c] px-4 py-2.5 text-xs font-bold text-white transition-transform hover:-translate-y-0.5" onClick={() => refetch()} data-testid="button-retry-analysis"><RefreshCw size={14} /> 再試一次</button>
                    <button className="rounded-lg border border-[#e4d3cf] bg-white px-4 py-2.5 text-xs font-bold text-[#776662] hover:bg-[#fff5f2]" onClick={() => { setInputTicker('0700.HK'); setTicker('0700.HK'); }} data-testid="button-reset-ticker">返回預設代號</button>
                  </div>
                </div>
              </section>
            ) : !data ? <EmptyState /> : (
              <div className="space-y-6">
                 <div className="flex flex-col justify-end gap-2 sm:flex-row sm:items-end">
                   <label className="text-[10px] font-semibold text-[#718184]">RSTR 阈值（σ）<input type="number" min="-3" max="3" step="0.1" value={rstrThreshold} onChange={(event) => setRstrThreshold(Number(event.target.value) || 0)} className="ml-2 h-9 w-20 rounded-lg border border-[#d8e1de] bg-white px-2 font-mono text-[11px] text-[#33474c]" data-testid="input-rstr-threshold" /></label>
                   <label className="text-[10px] font-semibold text-[#718184]">STOM 阈值（σ）<input type="number" min="-3" max="3" step="0.1" value={stomThreshold} onChange={(event) => setStomThreshold(Number(event.target.value) || 0)} className="ml-2 h-9 w-20 rounded-lg border border-[#d8e1de] bg-white px-2 font-mono text-[11px] text-[#33474c]" data-testid="input-stom-threshold" /></label>
                   <label className="text-[10px] font-semibold text-[#718184]">短期（交易日）<input type="number" min="5" max="63" step="1" value={shortDays} onChange={(event) => setShortDays(Math.max(5, Math.min(63, Number(event.target.value) || 5)))} className="ml-2 h-9 w-20 rounded-lg border border-[#d8e1de] bg-white px-2 font-mono text-[11px] text-[#33474c]" data-testid="input-short-days" /></label>
                   <label className="text-[10px] font-semibold text-[#718184]">中期（交易日）<input type="number" min="21" max="126" step="1" value={mediumDays} onChange={(event) => setMediumDays(Math.max(21, Math.min(126, Number(event.target.value) || 21)))} className="ml-2 h-9 w-20 rounded-lg border border-[#d8e1de] bg-white px-2 font-mono text-[11px] text-[#33474c]" data-testid="input-medium-days" /></label>
                   <label className="text-[10px] font-semibold text-[#718184]">长期（交易日）<input type="number" min="63" max="504" step="1" value={longDays} onChange={(event) => setLongDays(Math.max(63, Math.min(504, Number(event.target.value) || 63)))} className="ml-2 h-9 w-20 rounded-lg border border-[#d8e1de] bg-white px-2 font-mono text-[11px] text-[#33474c]" data-testid="input-long-days" /></label>
                   <label className="text-[10px] font-semibold text-[#718184]">手续费（单边 bps）<input type="number" min="0" max="100" step="1" value={feeBps} onChange={(event) => setFeeBps(Number(event.target.value) || 0)} className="ml-2 h-9 w-20 rounded-lg border border-[#d8e1de] bg-white px-2 font-mono text-[11px] text-[#33474c]" data-testid="input-fee-bps" /></label>
                   <label className="text-[10px] font-semibold text-[#718184]">滑点（单边 bps）<input type="number" min="0" max="100" step="1" value={slippageBps} onChange={(event) => setSlippageBps(Number(event.target.value) || 0)} className="ml-2 h-9 w-20 rounded-lg border border-[#d8e1de] bg-white px-2 font-mono text-[11px] text-[#33474c]" data-testid="input-slippage-bps" /></label>
                  <button onClick={() => setBacktestRequested(true)} disabled={backtestQuery.isFetching} className="flex items-center gap-2 rounded-lg bg-[#23383c] px-4 py-2.5 text-xs font-bold text-white transition-transform hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-60" data-testid="button-run-backtest"><RefreshCw size={14} className={backtestQuery.isFetching ? 'animate-spin' : ''} />{backtestQuery.isFetching ? '回测计算中…' : '运行历史回测'}</button>
                </div>
                {backtestRequested && <BacktestPanel data={backtestQuery.data} isLoading={backtestQuery.isLoading} isError={backtestQuery.isError} onRetry={() => { void backtestQuery.refetch(); }} />}
                <section className="animate-rise-in rounded-2xl border border-[#dfe5e4] bg-[#fbfdfc] px-5 py-5 shadow-[0_4px_18px_rgba(24,48,52,.035)] md:px-6" data-testid="card-security-summary">
                  <div className="flex flex-col justify-between gap-5 md:flex-row md:items-center">
                    <div className="flex items-center gap-4">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#e7f3ef] text-[15px] font-extrabold text-[#087d68]">{data.ticker.slice(0, 2)}</div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2"><h2 className="text-[20px] font-extrabold tracking-[-.045em] text-[#223238]" data-testid="text-security-name">{data.name}</h2><span className="rounded bg-[#edf1f0] px-2 py-1 font-mono text-[10px] font-medium text-[#607177]" data-testid="text-security-ticker">{data.ticker}</span></div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#7f8d91]"><span>{data.currency}</span><span className="h-3 w-px bg-[#d8dfdd]" /><span>資料區間：{formatDate(data.startDate)} — {formatDate(data.endDate)}</span><span className="rounded bg-[#eef4f2] px-1.5 py-0.5 font-mono text-[9px] text-[#5c7773]">來源：{data.source}</span></div>
                      </div>
                    </div>
                    <div className="flex items-center gap-6 md:pr-2">
                      <div><div className="text-[10px] font-semibold text-[#8a9699]">最新收市價</div><div className="mt-1 font-mono text-[23px] font-medium tracking-[-.05em] text-[#24373b]" data-testid="value-latest-close">{formatNumber(data.latestClose)}</div></div>
                      <div className="h-9 w-px bg-[#e0e6e4]" />
                      <div><div className="text-[10px] font-semibold text-[#8a9699]">抓取時間</div><div className="mt-1 font-mono text-[11px] text-[#52676a]" data-testid="text-fetched-at">{formatDate(data.fetchedAt)}</div></div>
                    </div>
                  </div>
                   {priceAnalysis && <AnalysisNote title="價格與短線狀態" tone={priceAnalysis.latest?.return !== null && priceAnalysis.latest.return < 0 ? 'caution' : 'neutral'}>{priceAnalysis.text}</AnalysisNote>}
                </section>

                 <ValuationAssessmentCard
                   data={valuationQuery.data}
                   isLoading={valuationQuery.isLoading}
                   isError={valuationQuery.isError}
                   onRetry={() => { void valuationQuery.refetch(); }}
                 />

                <div className="grid gap-5 md:grid-cols-2">
                   <div>
                     <FactorCard label="價格動能" code="RSTR" value={data.momentum} description="12個月對數收益 · 排除近1個月" window={`${formatDate(data.momentumWindowStart, false)} — ${formatDate(data.momentumWindowEnd, false)}`} icon={TrendingUp} />
                     {momentumAnalysis && <AnalysisNote title="RSTR 解讀" tone={momentumAnalysis.tone}>{momentumAnalysis.text}</AnalysisNote>}
                   </div>
                   <div>
                     <FactorCard label="交易流動性" code="STOM" value={data.liquidity} description="1個月累積成交量 · 對數標準化" window={`${formatDate(data.liquidityWindowStart, false)} — ${formatDate(data.liquidityWindowEnd, false)}`} icon={BarChart3} />
                     {liquidityAnalysis && <AnalysisNote title="STOM 解讀" tone={liquidityAnalysis.tone}>{liquidityAnalysis.text}</AnalysisNote>}
                   </div>
                </div>

                 {factorRelationship && <AnalysisNote title="雙因子綜合判讀" tone={factorRelationship.tone}>{factorRelationship.text}</AnalysisNote>}

                {data && (
                  <section
                    className={`animate-rise-in rounded-2xl border p-5 shadow-[0_4px_18px_rgba(24,48,52,.035)] md:p-6 ${
                      data.crowdingRiskLevel === '極端風險'
                        ? 'border-[#f0c9c4] bg-[#fff8f6]'
                        : data.crowdingRiskLevel === '偏高'
                          ? 'border-[#ead9ad] bg-[#fffdf5]'
                          : 'border-[#dfe5e4] bg-[#fbfdfc]'
                    }`}
                    data-testid="card-crowding-risk"
                  >
                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                      <div className="flex items-start gap-3">
                        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                          data.crowdingRiskLevel === '極端風險' ? 'bg-[#fde9e5] text-[#c45243]' : data.crowdingRiskLevel === '偏高' ? 'bg-[#fff1cf] text-[#a06b12]' : 'bg-[#e8f4f0] text-[#087d68]'
                        }`}>
                          <ShieldAlert size={19} />
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-[10px] font-bold uppercase tracking-[.14em] text-[#52736c]">擁擠度風險代理</span>
                            <span className="rounded bg-[#edf2f0] px-1.5 py-0.5 text-[9px] font-bold text-[#6f817f]">252D HISTORICAL</span>
                          </div>
                          <h3 className="mt-1 text-[16px] font-extrabold tracking-[-.025em] text-[#2f4145]">個股因子擁擠度：{data.crowdingRiskLevel}</h3>
                          <p className="mt-1 text-[11px] leading-5 text-[#78898b]">{data.crowdingAnalysis}</p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3 rounded-xl border border-[#e2e9e6] bg-white px-4 py-2.5">
                        <div><div className="text-[10px] text-[#899599]">代理分數</div><div className="font-mono text-xl font-semibold text-[#2d4146]">{data.crowdingRiskLevel === '資料不足' ? '—' : data.crowdingScore}</div></div>
                        {data.crowdingRiskLevel !== '資料不足' && <div className="h-10 w-1.5 overflow-hidden rounded-full bg-[#e7eeeb]"><div className={`w-full rounded-full ${data.crowdingRiskLevel === '極端風險' ? 'bg-[#c45243]' : data.crowdingRiskLevel === '偏高' ? 'bg-[#d59a2d]' : 'bg-[#159678]'}`} style={{ height: `${Math.max(8, data.crowdingScore)}%` }} /></div>}
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
                      <div className="rounded-xl border border-[#e2e9e6] bg-white px-3.5 py-3">
                        <div className="text-[10px] font-bold uppercase tracking-[.1em] text-[#52736c]">觸發依據</div>
                        {data.crowdingDrivers.length ? <div className="mt-2 flex flex-wrap gap-2">{data.crowdingDrivers.map((driver) => <span key={driver} className="rounded-full bg-[#f0f5f2] px-2.5 py-1 text-[10px] font-semibold text-[#526d68]">{driver}</span>)}</div> : <p className="mt-2 text-[11px] text-[#899599]">{data.crowdingRiskLevel === '資料不足' ? '需要至少約 2 年日線資料建立標準化基準。' : '目前沒有單一極端觸發項目。'}</p>}
                      </div>
                      <div className="rounded-xl border border-[#e2e9e6] bg-white px-3.5 py-3 text-[10px] text-[#899599] md:min-w-[190px]">
                        <div className="font-bold text-[#52736c]">觀察窗口</div>
                        <div className="mt-1 font-mono">{formatDate(data.crowdingWindowStart, false)} —</div>
                        <div className="font-mono">{formatDate(data.crowdingWindowEnd, false)}</div>
                      </div>
                    </div>
                    <p className="mt-4 border-t border-[#e7ecea] pt-3 text-[10px] leading-5 text-[#899599]">這是根據該股票自身歷史 RSTR／STOM 極端程度與持續性的代理指標，不等於全市場基金持倉擁擠度、因子橫截面百分位或資金淨流入。</p>
                  </section>
                )}

                {data.divergenceAlert && (
                  <section className="animate-rise-in rounded-2xl border border-[#f0c9c4] bg-[#fff8f6] p-5 shadow-[0_4px_18px_rgba(180,60,40,.06)] md:p-6" data-testid="card-divergence-alert">
                    <div className="flex items-start gap-4">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#fde9e5] text-[#c45243]">
                        <span className="text-[20px]">🚨</span>
                      </div>
                      <div className="min-w-0">
                        <div className="font-mono text-[10px] font-bold uppercase tracking-[.14em] text-[#c45243]">量化背離預警</div>
                        <h3 className="mt-1 text-[15px] font-extrabold tracking-[-.025em] text-[#3b2f2c]">放量滯漲 · 主力高位派發風險</h3>
                        <div className="mt-3 space-y-2 text-[11px] leading-5 text-[#6b5450]">
                          <p><span className="font-bold text-[#c45243]">診斷狀態：</span>系統偵測到交易流動性（STOM）出現極端過熱（Z &gt; +2σ），但價格動能（RSTR）仍處於負值區間（Z &lt; 0）。</p>
                          <p><span className="font-bold text-[#c45243]">技術特徵：</span>大量成交未能有效推高價格，多空分歧極大，逢高套現的賣壓沉重。</p>
                          <p><span className="font-bold text-[#c45243]">前市提示：</span>短線請勿盲目追高，密切防範買盤衰竭後的「久盤必跌」破位下行。</p>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <span className="rounded-full bg-[#fde9e5] px-2.5 py-1 font-mono text-[9px] font-bold text-[#c45243]">STOM Z &gt; +2σ</span>
                          <span className="rounded-full bg-[#fde9e5] px-2.5 py-1 font-mono text-[9px] font-bold text-[#c45243]">RSTR Z &lt; 0</span>
                          <span className="rounded-full bg-[#fff3d2] px-2.5 py-1 font-mono text-[9px] font-bold text-[#9a6a13]">僅供研究參考</span>
                        </div>
                      </div>
                    </div>
                  </section>
                )}

                <section className="animate-rise-in animate-rise-in-delay-2 rounded-2xl border border-[#dfe5e4] bg-[#fbfdfc] p-5 shadow-[0_4px_18px_rgba(24,48,52,.035)] md:p-6" data-testid="card-history-chart">
                  <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
                    <div><div className="flex items-center gap-2"><Activity size={16} className="text-[#07876d]" /><h2 className="text-[15px] font-extrabold tracking-[-.025em] text-[#26373c]">歷史路徑</h2><span className="rounded bg-[#e9f4f0] px-1.5 py-0.5 text-[9px] font-bold text-[#07876d]">可檢視</span></div><p className="mt-1 text-[11px] text-[#899599]">價格與成交量是兩個因子讀數的原始輸入</p></div>
                    <div className="flex rounded-lg bg-[#edf2f0] p-1" role="tablist" aria-label="切換歷史資料">
                      <button className={`rounded-md px-3 py-1.5 text-[10px] font-bold transition-colors ${chartMode === 'momentum' ? 'bg-[#fbfdfc] text-[#087d68] shadow-sm' : 'text-[#829095] hover:text-[#41545a]'}`} onClick={() => setChartMode('momentum')} role="tab" aria-selected={chartMode === 'momentum'} data-testid="button-chart-price"><TrendingUp size={12} className="mr-1 inline" />價格動能</button>
                      <button className={`rounded-md px-3 py-1.5 text-[10px] font-bold transition-colors ${chartMode === 'liquidity' ? 'bg-[#fbfdfc] text-[#087d68] shadow-sm' : 'text-[#829095] hover:text-[#41545a]'}`} onClick={() => setChartMode('liquidity')} role="tab" aria-selected={chartMode === 'liquidity'} data-testid="button-chart-volume"><BarChart3 size={12} className="mr-1 inline" />成交量</button>
                      <button className={`rounded-md px-3 py-1.5 text-[10px] font-bold transition-colors ${chartMode === 'factors' ? 'bg-[#fbfdfc] text-[#087d68] shadow-sm' : 'text-[#829095] hover:text-[#41545a]'}`} onClick={() => setChartMode('factors')} role="tab" aria-selected={chartMode === 'factors'} data-testid="button-chart-factors"><SlidersHorizontal size={12} className="mr-1 inline" />因子路徑</button>
                    </div>
                  </div>
                  {chartMode === 'factors'
                    ? <FactorPathChart data={factorData} />
                    : <Chart data={factorData} mode={chartMode} currency={data.currency} />}
                  <AnalysisNote title="歷史路徑觀察">價格與成交量是因子的原始輸入；路徑應用於辨識趨勢、波動與成交活躍度是否同步。請優先觀察因子是否連續多日改善或惡化，而不是以單一尖峰作結論。</AnalysisNote>
                </section>

                <div className="grid gap-5 lg:grid-cols-[1.1fr_.9fr]">
                  <section className="animate-rise-in animate-rise-in-delay-3 rounded-2xl border border-[#dfe5e4] bg-[#fbfdfc] p-5 shadow-[0_4px_18px_rgba(24,48,52,.035)] md:p-6" data-testid="card-factor-method">
                    <div className="flex items-start justify-between"><div><div className="flex items-center gap-2"><SlidersHorizontal size={16} className="text-[#07876d]" /><h2 className="text-[15px] font-extrabold tracking-[-.025em] text-[#26373c]">計算視窗</h2></div><p className="mt-1 text-[11px] text-[#899599]">每個讀數如何從市場資料而來</p></div><button className={`rounded-lg p-2 transition-colors ${methodHelpOpen ? 'bg-[#e4f4ef] text-[#087d68]' : 'text-[#8c999a] hover:bg-[#edf3f1] hover:text-[#087d68]'}`} onClick={() => setMethodHelpOpen((open) => !open)} aria-label="查看計算說明" aria-expanded={methodHelpOpen} data-testid="button-method-help"><CircleHelp size={16} /></button></div>
                    {methodHelpOpen && <div className="mt-4 rounded-lg border border-[#dcece6] bg-[#f0f8f5] px-3 py-2.5 text-[11px] leading-5 text-[#52736c]" data-testid="text-method-help">讀數先以歷史截面標準化，再映射至同一個可比較的尺度。正值代表相對偏強，負值代表相對偏弱。</div>}
                    <div className="mt-6 space-y-5">
                      <div className="relative pl-8"><span className="absolute left-0 top-0 flex h-5 w-5 items-center justify-center rounded-full bg-[#dff1eb] font-mono text-[10px] font-bold text-[#07876d]">01</span><div className="flex items-center justify-between gap-3"><div className="text-xs font-bold text-[#33474c]">價格動能 · RSTR</div><div className="font-mono text-[10px] text-[#7f8d91]">{formatDate(data.momentumWindowStart, false)} — {formatDate(data.momentumWindowEnd, false)}</div></div><p className="mt-1.5 text-[11px] leading-5 text-[#819094]">12個月對數收益率累加（shift 21天，231天窗口），再以1年歷史 Z-score 標準化。</p><div className="mt-3 h-1 rounded-full bg-[#e7efec]"><div className="h-full w-[78%] rounded-full bg-[#0d9b7d]" /></div></div>
                      <div className="relative pl-8"><span className="absolute left-0 top-0 flex h-5 w-5 items-center justify-center rounded-full bg-[#fff0c7] font-mono text-[10px] font-bold text-[#9a6a13]">02</span><div className="flex items-center justify-between gap-3"><div className="text-xs font-bold text-[#33474c]">交易流動性 · STOM</div><div className="font-mono text-[10px] text-[#7f8d91]">{formatDate(data.liquidityWindowStart, false)} — {formatDate(data.liquidityWindowEnd, false)}</div></div><p className="mt-1.5 text-[11px] leading-5 text-[#819094]">21個交易日累積成交量取對數，再以1年歷史 Z-score 標準化。正值代表流動性偏高。</p><div className="mt-3 h-1 rounded-full bg-[#e7efec]"><div className="h-full w-[53%] rounded-full bg-[#d6a132]" /></div></div>
                    </div>
                  </section>
                  <section className="animate-rise-in animate-rise-in-delay-3 rounded-2xl border border-[#dfe5e4] bg-[#fbfdfc] p-5 shadow-[0_4px_18px_rgba(24,48,52,.035)] md:p-6" data-testid="card-market-inputs">
                    <div className="flex items-start justify-between"><div><div className="flex items-center gap-2"><Database size={16} className="text-[#07876d]" /><h2 className="text-[15px] font-extrabold tracking-[-.025em] text-[#26373c]">市場輸入摘要</h2></div><p className="mt-1 text-[11px] text-[#899599]">本次計算使用的核心觀察值</p></div><button className="rounded-lg p-2 text-[#8c999a] transition-colors hover:bg-[#edf3f1] hover:text-[#087d68]" onClick={downloadSummary} aria-label="下載分析摘要" data-testid="button-download-summary"><Download size={16} /></button></div>
                     <div className="mt-6 grid grid-cols-2 gap-x-5 gap-y-5">
                       <div><div className="text-[10px] font-semibold text-[#8a9699]">平均成交量</div><div className="mt-1.5 font-mono text-[18px] tracking-[-.04em] text-[#2d4146]" data-testid="value-average-volume">{formatCompact(data.averageVolume)}</div><div className="mt-1 text-[10px] text-[#9ba5a7]">股 / 日</div></div>
                       <div><div className="text-[10px] font-semibold text-[#8a9699]">成交金額代理</div><div className="mt-1.5 font-mono text-[18px] tracking-[-.04em] text-[#2d4146]" data-testid="value-average-turnover">{formatCompact(data.averageTurnoverProxy)}</div><div className="mt-1 text-[10px] text-[#9ba5a7]">{data.currency} / 日</div></div>
                      <div className="col-span-2 border-t border-[#e7ecea] pt-4"><div className="flex items-center gap-2 text-[10px] font-semibold text-[#8a9699]"><Check size={13} className="text-[#159b7d]" /> 資料品質檢查</div><div className="mt-2 flex items-center justify-between"><span className="text-[11px] text-[#506269]">完整交易日</span><span className="rounded-full bg-[#e4f4ef] px-2 py-1 font-mono text-[9px] font-medium text-[#087d68]">{factorData.length} 個觀測值</span></div></div>
                    </div>
                     <AnalysisNote title="成交與資料質量">平均成交量與成交金額代理反映市場參與度及可能的交易承載能力，但不等同於淨資金流入。樣本涵蓋 {factorData.length} 個交易日，已足夠支援目前的 252 日歷史標準化窗口。</AnalysisNote>
                  </section>
                </div>

                <footer className="flex flex-col gap-2 border-t border-[#dce4e1] pb-5 pt-4 text-[10px] leading-5 text-[#899598] sm:flex-row sm:items-center sm:justify-between">
                  <span>因子讀數為標準化研究指標，不代表投資建議。資料由 Yahoo Finance 提供。</span>
                  <span className="font-mono tracking-[.06em]">最後更新 · {formatDate(data.fetchedAt)}</span>
                </footer>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}