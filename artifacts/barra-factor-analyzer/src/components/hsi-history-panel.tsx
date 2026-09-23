import { Database } from 'lucide-react';
import { useMemo } from 'react';
import type { MarketHistory, RealtimeMarketData } from '@workspace/api-client-react';

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

type Props = {
  data: MarketHistory | undefined;
  liveSnapshot: RealtimeMarketData | undefined;
  isLiveFetching: boolean;
  isLiveError: boolean;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
};

function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-Hant-HK', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Hong_Kong',
  }).format(new Date(value));
}

export function HsiHistoryPanel({ data, liveSnapshot, isLiveFetching, isLiveError, isLoading, isError, onRetry }: Props) {
  const chartPoints = useMemo(() => {
    if (!data?.points.length) return '';
    const values = data.points.map((point) => point.close);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    return data.points.map((point, index) => {
      const x = 12 + (index / Math.max(data.points.length - 1, 1)) * 576;
      const y = 12 + (1 - (point.close - min) / range) * 116;
      return `${x},${y}`;
    }).join(' ');
  }, [data]);

  if (isLoading) {
    return <section className="rounded-2xl border border-[#dfe5e4] bg-[#fbfdfc] p-5" data-testid="card-hsi-history-loading"><div className="h-5 w-48 animate-pulse rounded bg-[#e5e9e9]" /><div className="mt-4 h-36 animate-pulse rounded-xl bg-[#eef2f0]" /></section>;
  }

  if (isError || !data?.points.length) {
    return <section className="rounded-2xl border border-[#ecd0ca] bg-[#fffaf9] p-5" data-testid="card-hsi-history-error"><div className="font-bold text-[#b04d40]">恆指資料庫資料暫時無法讀取</div><button onClick={onRetry} className="mt-3 rounded-lg bg-[#23383c] px-4 py-2 text-xs font-bold text-white">重新讀取</button></section>;
  }

  const latestPoint = data.points[data.points.length - 1];
  return (
    <section className="rounded-2xl border border-[#dfe5e4] bg-[#fbfdfc] p-5 shadow-[0_4px_18px_rgba(24,48,52,.035)] md:p-6" data-testid="card-hsi-history">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
        <div>
          <div className="flex items-center gap-2"><Database size={16} className="text-[#07876d]" /><h2 className="text-[15px] font-extrabold text-[#26373c]">恆指最近30日</h2><span className="rounded bg-[#e9f4f0] px-1.5 py-0.5 text-[9px] font-bold text-[#07876d]">DATABASE · AUTO</span></div>
          <p className="mt-1 text-[11px] text-[#899599]">{data.startDate} — {data.endDate} · {data.source} · 每5分鐘自動更新</p>
        </div>
        <div className="flex flex-wrap items-start gap-5 text-left md:justify-end md:text-right">
          <div>
            <div className="flex items-center gap-1.5 md:justify-end"><span className={`h-1.5 w-1.5 rounded-full ${isLiveFetching ? 'animate-pulse bg-[#d6a132]' : liveSnapshot ? 'bg-[#159b7d]' : 'bg-[#c45243]'}`} /><span className="text-[10px] font-bold text-[#53676b]">恒指現時現價</span></div>
            <div className={`font-mono text-lg font-semibold ${liveSnapshot ? 'text-[#087d68]' : 'text-[#849294]'}`}>{liveSnapshot ? formatNumber(liveSnapshot.latestPrice, 2) : '—'}</div>
            <div className="text-[10px] text-[#899599]">{isLiveError ? '暫無更新' : liveSnapshot ? `${liveSnapshot.isIntraday ? '盤中' : '最近收市'} · ${formatTime(liveSnapshot.updatedAt)}` : '讀取中'}</div>
          </div>
          <div>
            <div className="text-[10px] font-bold text-[#53676b]">最近已保存收市價</div>
            <div className="font-mono text-lg font-semibold text-[#087d68]">{formatNumber(latestPoint.close, 2)}</div>
            <div className="text-[10px] text-[#899599]">歷史日線資料</div>
          </div>
        </div>
      </div>
      <div className="mt-4 rounded-xl border border-[#e2e9e6] bg-white px-3 py-3">
        <svg className="h-36 w-full" viewBox="0 0 600 140" preserveAspectRatio="none" role="img" aria-label="恆指最近30日收市價走勢">
          <line x1="12" x2="588" y1="128" y2="128" stroke="#e7ecea" />
          <polyline points={chartPoints} fill="none" stroke="#07876d" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
        <div className="flex justify-between font-mono text-[10px] text-[#98a0aa]"><span>{data.startDate}</span><span>{data.endDate}</span></div>
      </div>
      <div className="mt-4 max-h-[330px] overflow-y-auto rounded-xl border border-[#e2e9e6] bg-white">
        <table className="w-full text-left text-[11px]" data-testid="table-hsi-history">
          <thead className="sticky top-0 bg-[#f4f9f7] text-[#78918d]"><tr><th className="px-3 py-2 font-semibold">交易日</th><th className="px-3 py-2 text-right font-semibold">收市價</th><th className="px-3 py-2 text-right font-semibold">日變動</th><th className="px-3 py-2 text-right font-semibold">成交量</th></tr></thead>
          <tbody>{[...data.points].reverse().map((point) => <tr key={point.date} className="border-t border-[#eef2f0]"><td className="px-3 py-2 font-mono text-[#52676a]">{point.date}</td><td className="px-3 py-2 text-right font-mono text-[#33474c]">{formatNumber(point.close, 2)}</td><td className={`px-3 py-2 text-right font-mono ${point.changePercent === null || point.changePercent >= 0 ? 'text-[#087d68]' : 'text-[#c45243]'}`}>{point.changePercent === null ? '—' : `${point.changePercent >= 0 ? '+' : ''}${(point.changePercent * 100).toFixed(2)}%`}</td><td className="px-3 py-2 text-right font-mono text-[#899599]">{point.volume > 0 ? formatCompact(point.volume) : '—'}</td></tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}