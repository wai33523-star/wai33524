import { Activity, CircleHelp, TrendingDown, TrendingUp } from 'lucide-react';
import type { HsiValueRecoverySelection, HsiValuationSelection, ValuationAssessment } from '@workspace/api-client-react';

function pct(value: number | null) {
  return value === null ? '—' : `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`;
}

function number(value: number | null, digits = 1) {
  return value === null ? '—' : value.toFixed(digits);
}

function statusStyle(status: ValuationAssessment['screeningResult']) {
  if (status === '符合') return 'bg-[#e4f4ef] text-[#087d68]';
  if (status === '部分符合') return 'bg-[#fff3d2] text-[#9a6a13]';
  if (status === '不符合') return 'bg-[#f9e8e5] text-[#c45243]';
  return 'bg-[#edf1f0] text-[#6f817f]';
}

function valuationTone(status: ValuationAssessment['valuationStatus']) {
  if (status === '低於歷史中位數') return 'text-[#087d68]';
  if (status === '高於歷史中位數') return 'text-[#c45243]';
  return 'text-[#9a6a13]';
}

type AssessmentProps = {
  data: ValuationAssessment | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
};

export function ValuationAssessmentCard({ data, isLoading, isError, onRetry }: AssessmentProps) {
  if (isLoading) {
    return <section className="rounded-2xl border border-[#dfe5e4] bg-[#fbfdfc] p-5" data-testid="card-valuation-loading"><div className="h-5 w-56 animate-pulse rounded bg-[#e5e9e9]" /><div className="mt-4 grid gap-3 md:grid-cols-4">{[1, 2, 3, 4].map((item) => <div key={item} className="h-20 animate-pulse rounded-xl bg-[#eef2f0]" />)}</div></section>;
  }

  if (isError || !data) {
    return (
      <section className="rounded-2xl border border-[#ecd0ca] bg-[#fffaf9] p-5" data-testid="card-valuation-error">
        <div className="font-bold text-[#b04d40]">基本面估值資料暫時無法讀取</div>
        <p className="mt-1 text-[11px] text-[#8b716c]">Yahoo Finance 可能未提供此代號的盈利或 P/E 時間序列。</p>
        <button onClick={onRetry} className="mt-3 rounded-lg bg-[#23383c] px-4 py-2 text-xs font-bold text-white">重新讀取</button>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-[#dfe5e4] bg-[#fbfdfc] p-5 shadow-[0_4px_18px_rgba(24,48,52,.035)] md:p-6" data-testid="card-valuation-assessment">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
        <div>
          <div className="flex items-center gap-2"><Activity size={16} className="text-[#07876d]" /><h2 className="text-[15px] font-extrabold text-[#26373c]">盈利潛力 × 估值壓制</h2><span className="rounded bg-[#e9f4f0] px-1.5 py-0.5 text-[9px] font-bold text-[#07876d]">FUNDAMENTAL · AUTO</span></div>
          <p className="mt-1 text-[11px] text-[#899599]">基本面截至 {data.dataAsOf} · 股價截至 {data.priceAsOf} · {data.source}</p>
        </div>
        <span className={`rounded-full px-3 py-1.5 text-[10px] font-extrabold ${statusStyle(data.screeningResult)}`}>{data.screeningResult} · {data.opportunityScore}分</span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl border border-[#e2e9e6] bg-white p-3.5"><div className="text-[10px] text-[#899599]">TTM P/E</div><div className="mt-1 font-mono text-xl font-semibold text-[#33474c]">{number(data.trailingPe)}<span className="ml-1 text-[10px] text-[#899599]">倍</span></div><div className="mt-1 text-[9px] text-[#a0a9aa]">{data.trailingPeAsOf ?? '暫無日期'}</div></div>
        <div className="rounded-xl border border-[#e2e9e6] bg-white p-3.5"><div className="text-[10px] text-[#899599]">歷史 P/E 中位數</div><div className={`mt-1 font-mono text-xl font-semibold ${valuationTone(data.valuationStatus)}`}>{number(data.peMedian)}<span className="ml-1 text-[10px] text-[#899599]">倍</span></div><div className="mt-1 text-[9px] text-[#a0a9aa]">{data.valuationStatus}</div></div>
        <div className="rounded-xl border border-[#e2e9e6] bg-white p-3.5"><div className="text-[10px] text-[#899599]">收入年增</div><div className={`mt-1 font-mono text-xl font-semibold ${data.revenueGrowth !== null && data.revenueGrowth >= 0 ? 'text-[#087d68]' : 'text-[#c45243]'}`}>{pct(data.revenueGrowth)}</div><div className="mt-1 text-[9px] text-[#a0a9aa]">年度公開數據</div></div>
        <div className="rounded-xl border border-[#e2e9e6] bg-white p-3.5"><div className="text-[10px] text-[#899599]">最新年度 EPS</div><div className={`mt-1 font-mono text-xl font-semibold ${data.latestEps !== null && data.latestEps > 0 ? 'text-[#087d68]' : 'text-[#c45243]'}`}>{number(data.latestEps, 2)}</div><div className="mt-1 text-[9px] text-[#a0a9aa]">年報期末 · {data.dataAsOf}</div></div>
        <div className="rounded-xl border border-[#e2e9e6] bg-white p-3.5"><div className="text-[10px] text-[#899599]">中期參考 EPS · TTM</div><div className={`mt-1 font-mono text-xl font-semibold ${data.latestTtmEps !== null && data.latestTtmEps > 0 ? 'text-[#087d68]' : 'text-[#c45243]'}`}>{number(data.latestTtmEps, 2)}</div><div className="mt-1 text-[9px] text-[#a0a9aa]">滾動12個月 · {data.ttmEpsAsOf ?? '暫無日期'}</div></div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-[#e2e9e6] bg-white px-3.5 py-3 text-[11px] leading-5 text-[#637477]"><span className="font-bold text-[#52736c]">盈利潛力：</span><span className="font-semibold">{data.earningsPotential}</span> · {data.reason}</div>
        <div className="rounded-xl border border-[#e2e9e6] bg-white px-3.5 py-3 text-[11px] leading-5 text-[#637477]"><span className="font-bold text-[#52736c]">期間說明：</span>年度 EPS 取最新年報；中期參考 EPS 是 TTM 滾動12個月，不等同年報或單一中期報告。正 EPS 篩選使用年度數字，TTM P/E 與 TTM EPS 用來配對近期估值。</div>
      </div>
      <p className="mt-4 flex items-start gap-1.5 border-t border-[#e7ecea] pt-3 text-[10px] leading-5 text-[#899599]"><CircleHelp size={12} className="mt-0.5 shrink-0" />{data.limitation}</p>
    </section>
  );
}

type PicksProps = {
  data: HsiValuationSelection | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onSelectTicker: (ticker: string) => void;
};

export function HsiValuationPicks({ data, isLoading, isError, onRetry, onSelectTicker }: PicksProps) {
  if (isLoading) {
    return <section className="rounded-2xl border border-[#dfe5e4] bg-[#fbfdfc] p-5" data-testid="card-hsi-valuation-loading"><div className="h-5 w-64 animate-pulse rounded bg-[#e5e9e9]" /><div className="mt-4 grid gap-3 md:grid-cols-5">{[1, 2, 3, 4, 5].map((item) => <div key={item} className="h-36 animate-pulse rounded-xl bg-[#eef2f0]" />)}</div></section>;
  }
  if (isError || !data) {
    return <section className="rounded-2xl border border-[#ecd0ca] bg-[#fffaf9] p-5" data-testid="card-hsi-valuation-error"><div className="font-bold text-[#b04d40]">恒指估值篩選暫時無法完成</div><p className="mt-1 text-[11px] text-[#8b716c]">需要候選股的公開 EPS、收入及 P/E 歷史資料。</p><button onClick={onRetry} className="mt-3 rounded-lg bg-[#23383c] px-4 py-2 text-xs font-bold text-white">重新篩選</button></section>;
  }

  return (
    <section className="rounded-2xl border border-[#dfe5e4] bg-[#fbfdfc] p-5 shadow-[0_4px_18px_rgba(24,48,52,.035)] md:p-6" data-testid="card-hsi-valuation-picks">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
        <div>
          <div className="flex items-center gap-2"><TrendingUp size={16} className="text-[#07876d]" /><h2 className="text-[15px] font-extrabold text-[#26373c]">恒指五隻性價比最高</h2><span className="rounded bg-[#e9f4f0] px-1.5 py-0.5 text-[9px] font-bold text-[#07876d]">AUTO · 15 MIN</span></div>
          <p className="mt-1 text-[11px] text-[#899599]">截至 {data.asOf} · 已評估 {data.evaluatedCount} / 核心候選 {data.universeSize} · 完全符合 {data.qualifiedCount} 隻</p>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] text-[#899599]"><TrendingDown size={13} className="text-[#d6904a]" />估值折讓不等於價格必然反彈</div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-5">
        {data.picks.map((pick, index) => (
          <button key={pick.ticker} type="button" onClick={() => onSelectTicker(pick.ticker)} className="rounded-xl border border-[#e2e9e6] bg-white p-4 text-left transition-colors hover:border-[#8bc5b5]" data-testid={`hsi-valuation-pick-${index + 1}`}>
            <div className="flex items-start justify-between gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#203238] font-mono text-xs font-bold text-[#f2c75b]">0{index + 1}</span><span className={`rounded-full px-2 py-1 font-mono text-[9px] font-bold ${statusStyle(pick.screeningResult)}`}>{pick.opportunityScore}分</span></div>
            <div className="mt-3 font-mono text-[14px] font-bold text-[#26373c]">{pick.ticker.replace('.HK', '')}</div>
            <div className="mt-1 truncate text-[11px] font-semibold text-[#52676a]">{pick.name}</div>
            <div className="mt-3 space-y-1.5 text-[10px] text-[#637477]"><div className="flex justify-between"><span>性價比分</span><span className="font-mono font-bold text-[#087d68]">{pick.opportunityScore}/100</span></div><div className="flex justify-between"><span>年度 EPS</span><span className={`font-mono ${pick.latestEps !== null && pick.latestEps > 0 ? 'text-[#087d68]' : 'text-[#c45243]'}`}>{number(pick.latestEps, 2)}</span></div><div className="flex justify-between"><span>中期/TTM EPS</span><span className="font-mono text-[#52676a]">{number(pick.latestTtmEps, 2)}</span></div><div className="flex justify-between"><span>P/E 折讓</span><span className={`font-mono ${valuationTone(pick.valuationStatus)}`}>{pct(pick.peDiscountVsMedian)}</span></div></div>
          </button>
        ))}
      </div>
      <p className="mt-4 flex items-start gap-1.5 border-t border-[#e7ecea] pt-3 text-[10px] leading-5 text-[#899599]"><CircleHelp size={12} className="mt-0.5 shrink-0" />{data.model}。{data.limitation}</p>
    </section>
  );
}

type ValueRecoveryProps = {
  data: HsiValueRecoverySelection | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  onSelectTicker: (ticker: string) => void;
};

export function HsiValueRecoveryPicks({ data, isLoading, isError, onRetry, onSelectTicker }: ValueRecoveryProps) {
  if (isLoading) {
    return <section className="rounded-2xl border border-[#eadfbd] bg-[#fffdf8] p-5" data-testid="card-hsi-value-recovery-loading"><div className="h-5 w-72 animate-pulse rounded bg-[#eee8d6]" /><div className="mt-4 grid gap-3 md:grid-cols-5">{[1, 2, 3, 4, 5].map((item) => <div key={item} className="h-40 animate-pulse rounded-xl bg-[#f4f0e4]" />)}</div></section>;
  }

  if (isError || !data) {
    return <section className="rounded-2xl border border-[#ecd0ca] bg-[#fffaf9] p-5" data-testid="card-hsi-value-recovery-error"><div className="font-bold text-[#b04d40]">性价比及落后潜力榜暂时无法完成</div><p className="mt-1 text-[11px] text-[#8b716c]">需要同时具备正 EPS、有效估值资料和落后反转信号。</p><button onClick={onRetry} className="mt-3 rounded-lg bg-[#23383c] px-4 py-2 text-xs font-bold text-white">重新筛选</button></section>;
  }

  return (
    <section className="rounded-2xl border border-[#eadfbd] bg-[#fffdf8] p-5 shadow-[0_4px_18px_rgba(24,48,52,.035)] md:p-6" data-testid="card-hsi-value-recovery-picks">
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
        <div>
          <div className="flex items-center gap-2"><TrendingUp size={16} className="text-[#b47c24]" /><h2 className="text-[15px] font-extrabold text-[#26373c]">另外五隻高性價比但落後有潛質</h2><span className="rounded bg-[#fff3d2] px-1.5 py-0.5 text-[9px] font-bold text-[#9a6a13]">VALUE × RECOVERY · 15 MIN</span></div>
          <p className="mt-1 text-[11px] text-[#899599]">截至 {data.asOf} · 已評估 {data.evaluatedCount} 隻 · 排除上方五隻後仍有 {data.eligibleCount} 隻符合條件</p>
        </div>
        <div className="rounded-lg bg-[#fff8e9] px-3 py-2 text-[10px] font-semibold text-[#9a6a13]">不重複上方榜單 · 估值便宜但價格仍相對落後</div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-5">
        {data.picks.map((pick) => (
          <button key={pick.ticker} type="button" onClick={() => onSelectTicker(pick.ticker)} className="rounded-xl border border-[#eadfbd] bg-white p-4 text-left transition-colors hover:border-[#d3ad60]" data-testid={`hsi-value-recovery-pick-${pick.rank}`}>
            <div className="flex items-start justify-between gap-2"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#203238] font-mono text-xs font-bold text-[#f2c75b]">0{pick.rank}</span><span className="rounded-full bg-[#e4f4ef] px-2 py-1 font-mono text-[9px] font-bold text-[#087d68]">{pick.score}分</span></div>
            <div className="mt-3 font-mono text-[14px] font-bold text-[#26373c]">{pick.ticker.replace('.HK', '')}</div>
            <div className="mt-1 truncate text-[11px] font-semibold text-[#52676a]">{pick.name}</div>
            <div className="mt-3 space-y-1.5 text-[10px] text-[#637477]">
              <div className="flex justify-between"><span>性價比分</span><span className="font-mono text-[#087d68]">{pick.valueScore}</span></div>
              <div className="flex justify-between"><span>落後反轉分</span><span className="font-mono text-[#9a6a13]">{pick.recoveryScore}</span></div>
              <div className="flex justify-between"><span>年度 EPS</span><span className="font-mono text-[#087d68]">{pick.latestEps.toFixed(2)}</span></div>
              <div className="flex justify-between"><span>中期/TTM EPS</span><span className="font-mono text-[#52676a]">{pick.latestTtmEps === null ? '—' : pick.latestTtmEps.toFixed(2)}</span></div>
              <div className="flex justify-between"><span>P/E 折讓</span><span className="font-mono text-[#087d68]">{pct(pick.peDiscountVsMedian)}</span></div>
            </div>
            <p className="mt-3 border-t border-[#f0eadb] pt-3 text-[10px] leading-4 text-[#718184]">{pick.reason}</p>
          </button>
        ))}
      </div>
      <p className="mt-4 flex items-start gap-1.5 border-t border-[#eee7d6] pt-3 text-[10px] leading-5 text-[#899599]"><CircleHelp size={12} className="mt-0.5 shrink-0" />{data.model}。{data.limitation}</p>
    </section>
  );
}