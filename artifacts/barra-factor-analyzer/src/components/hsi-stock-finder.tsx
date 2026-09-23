import { ArrowDownRight, ArrowUpRight, BrainCircuit, Search, TrendingDown, TrendingUp } from 'lucide-react';
import type { HsiMovers, HsiQualitySelection } from '@workspace/api-client-react';

type Props = {
  movers: HsiMovers | undefined;
  leaders: HsiQualitySelection | undefined;
  laggards: HsiQualitySelection | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onSelectTicker: (ticker: string) => void;
};

function formatNumber(value: number, digits = 2) {
  return new Intl.NumberFormat('zh-Hant-HK', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

function FinderColumn({
  title,
  note,
  tone,
  icon,
  tickers,
  onSelectTicker,
}: {
  title: string;
  note: string;
  tone: 'positive' | 'negative' | 'neutral';
  icon: React.ReactNode;
  tickers: Array<{ ticker: string; name: string; detail: string }>;
  onSelectTicker: (ticker: string) => void;
}) {
  const toneClass = tone === 'positive'
    ? 'border-[#d5e9e1] bg-[#f8fcfa] text-[#087d68]'
    : tone === 'negative'
      ? 'border-[#eadbd5] bg-[#fffaf8] text-[#b04d40]'
      : 'border-[#dfe5e4] bg-[#fbfdfc] text-[#52676a]';

  return (
    <div className={`rounded-xl border p-3.5 ${toneClass}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {icon}
          <div>
            <div className="text-[12px] font-extrabold">{title}</div>
            <div className="mt-0.5 text-[9px] opacity-70">{note}</div>
          </div>
        </div>
        <Search size={13} className="opacity-50" />
      </div>
      <div className="mt-3 space-y-1.5">
        {tickers.map((item, index) => (
          <button
            key={item.ticker}
            type="button"
            className="flex w-full items-center justify-between gap-2 rounded-lg border border-transparent bg-white/75 px-2.5 py-2 text-left transition-colors hover:border-current hover:bg-white"
            onClick={() => onSelectTicker(item.ticker)}
            data-testid={`button-hsi-finder-${item.ticker}`}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="font-mono text-[9px] opacity-50">0{index + 1}</span>
              <span className="min-w-0">
                <span className="block font-mono text-[11px] font-bold">{item.ticker.replace('.HK', '')}</span>
                <span className="block max-w-[100px] truncate text-[9px] opacity-65">{item.name}</span>
              </span>
            </span>
            <span className="shrink-0 font-mono text-[10px] font-bold">{item.detail}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function HsiStockFinder({ movers, leaders, laggards, isLoading, isError, onRetry, onSelectTicker }: Props) {
  if (isLoading) {
    return (
      <section className="rounded-2xl border border-[#dfe5e4] bg-[#fbfdfc] p-5" data-testid="card-hsi-stock-finder-loading">
        <div className="h-5 w-52 animate-pulse rounded bg-[#e5e9e9]" />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[1, 2, 3, 4].map((item) => <div key={item} className="h-48 animate-pulse rounded-xl bg-[#eef2f0]" />)}
        </div>
      </section>
    );
  }

  if (isError || !movers || !leaders || !laggards) {
    return (
      <section className="rounded-2xl border border-[#ecd0ca] bg-[#fffaf9] p-5" data-testid="card-hsi-stock-finder-error">
        <div className="font-bold text-[#b04d40]">恒指找股榜單暫時無法讀取</div>
        <p className="mt-1 text-[11px] text-[#8b716c]">領漲、領跌、領先及落後榜單需要最新候選股資料。</p>
        <button onClick={onRetry} className="mt-3 rounded-lg bg-[#23383c] px-4 py-2 text-xs font-bold text-white">重新讀取</button>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-[#dfe5e4] bg-[#fbfdfc] p-5 shadow-[0_4px_18px_rgba(24,48,52,.035)] md:p-6" data-testid="card-hsi-stock-finder">
      <div className="flex flex-col justify-between gap-2 md:flex-row md:items-end">
        <div>
          <div className="flex items-center gap-2"><Search size={16} className="text-[#07876d]" /><h2 className="text-[15px] font-extrabold text-[#26373c]">恒指找股快選</h2><span className="rounded bg-[#e9f4f0] px-1.5 py-0.5 text-[9px] font-bold text-[#07876d]">AUTO · 5 MIN</span></div>
          <p className="mt-1 text-[11px] text-[#899599]">按最新完整交易日及量價因子，點擊代號即可載入分析 · 榜單截至 {movers.asOf}</p>
        </div>
        <div className="text-[10px] text-[#899599]">已評分 {movers.scoredCount} / 核心候選 {movers.universeSize}</div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <FinderColumn title="領漲股" note="最新日線升幅最高" tone="positive" icon={<ArrowUpRight size={15} />} onSelectTicker={onSelectTicker} tickers={movers.gainers.map((item) => ({ ticker: item.ticker, name: item.name, detail: `+${(item.changePercent * 100).toFixed(2)}%` }))} />
        <FinderColumn title="領跌股" note="最新日線跌幅最大" tone="negative" icon={<ArrowDownRight size={15} />} onSelectTicker={onSelectTicker} tickers={movers.decliners.map((item) => ({ ticker: item.ticker, name: item.name, detail: `${(item.changePercent * 100).toFixed(2)}%` }))} />
        <FinderColumn title="領先股" note="中長期動能及趨勢" tone="neutral" icon={<TrendingUp size={15} className="text-[#07876d]" />} onSelectTicker={onSelectTicker} tickers={leaders.picks.map((item) => ({ ticker: item.ticker, name: item.name, detail: `${item.score.toFixed(0)}分` }))} />
        <FinderColumn title="落後股" note="量價模型弱勢觀察" tone="negative" icon={<TrendingDown size={15} className="text-[#b04d40]" />} onSelectTicker={onSelectTicker} tickers={laggards.picks.map((item) => ({ ticker: item.ticker, name: item.name, detail: `${item.score.toFixed(0)}分` }))} />
      </div>
      <div className="mt-3 flex items-start gap-2 rounded-xl border border-[#e2e9e6] bg-[#f4f9f7] px-3.5 py-3 text-[10px] leading-5 text-[#637477]">
        <BrainCircuit size={13} className="mt-0.5 shrink-0 text-[#d6a132]" />
        <span>領漲／領跌按最近完整交易日升跌幅排序；領先／落後按現有價格與成交量模型排序，不代表基本面評級或投資建議。</span>
      </div>
    </section>
  );
}