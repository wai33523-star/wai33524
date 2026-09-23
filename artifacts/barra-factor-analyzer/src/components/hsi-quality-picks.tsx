import { AlertTriangle, BrainCircuit, ShieldCheck, Sparkles, TrendingDown } from 'lucide-react';
import type { HsiQualitySelection } from '@workspace/api-client-react';

function scoreTone(score: number) {
  if (score >= 70) return 'text-[#087d68] bg-[#e4f4ef]';
  if (score >= 45) return 'text-[#9a6a13] bg-[#fff3d2]';
  return 'text-[#c45243] bg-[#f9e8e5]';
}

type Props = {
  data: HsiQualitySelection | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  mode?: 'quality' | 'laggard' | 'recovery' | 'leader' | 'pullback';
};

export function HsiQualityPicks({ data, isLoading, isError, onRetry, mode = 'quality' }: Props) {
  const isLaggard = mode === 'laggard';
  const isRecovery = mode === 'recovery';
  const isLeader = mode === 'leader';
  const isPullback = mode === 'pullback';
  const title = isLaggard ? '反向模型选5只恒指最劣质股' : isLeader ? '模型选5只领先且有潜质股' : isPullback ? '模型選5隻領先但具回檔潛質股' : '模型自动选5只恒指优质股';
  const displayTitle = isRecovery ? '模型选5只落后但有潜质股' : title;
  const badge = isLaggard ? '风险观察' : isRecovery ? '反转观察' : isPullback ? '回檔觀察' : isLeader ? '趋势观察' : '量价模型';
  const modeNote = isLaggard ? '同一评分反向排序' : isRecovery ? '弱势中的改善' : isPullback ? '領先中的修正' : isLeader ? '领先中的延续' : '可解释评分';
  if (isLoading) {
    return <section className="rounded-2xl border border-[#dfe5e4] bg-[#fbfdfc] p-5" data-testid={`card-hsi-${mode}-loading`}><div className="h-5 w-64 animate-pulse rounded bg-[#e5e9e9]" /><div className="mt-4 grid gap-3 md:grid-cols-5">{[1, 2, 3, 4, 5].map((item) => <div key={item} className="h-32 animate-pulse rounded-xl bg-[#eef2f0]" />)}</div></section>;
  }

  if (isError || !data) {
    return <section className="rounded-2xl border border-[#ecd0ca] bg-[#fffaf9] p-5" data-testid={`card-hsi-${mode}-error`}><div className="font-bold text-[#b04d40]">模型暂时无法完成恒指选股</div><button onClick={onRetry} className="mt-3 rounded-lg bg-[#23383c] px-4 py-2 text-xs font-bold text-white">重新计算</button></section>;
  }

  return (
    <section className={`rounded-2xl border p-5 shadow-[0_4px_18px_rgba(24,48,52,.035)] md:p-6 ${isLaggard ? 'border-[#eadbd5] bg-[#fffdfc]' : isPullback ? 'border-[#eadfbd] bg-[#fffdf8]' : 'border-[#dfe5e4] bg-[#fbfdfc]'}`} data-testid={`card-hsi-${mode}`}>
      <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
        <div>
          <div className="flex items-center gap-2">{isLaggard ? <AlertTriangle size={16} className="text-[#c45243]" /> : isPullback ? <TrendingDown size={16} className="text-[#c58a25]" /> : <BrainCircuit size={16} className="text-[#07876d]" />}<h2 className="text-[15px] font-extrabold text-[#26373c]">{displayTitle}</h2><span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${isLaggard ? 'bg-[#f9e8e5] text-[#b04d40]' : isRecovery || isPullback ? 'bg-[#fff3d2] text-[#9a6a13]' : 'bg-[#e9f4f0] text-[#087d68]'}`}>{badge}</span></div>
          <p className="mt-1 text-[11px] text-[#899599]">截至 {data.asOf} · 已评分 {data.scoredCount} / 核心候选 {data.universeSize} · {data.source}</p>
        </div>
        <div className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-[10px] font-semibold ${isLaggard ? 'bg-[#fff2ef] text-[#a2675e]' : isPullback ? 'bg-[#fff8e9] text-[#9a6a13]' : 'bg-[#f0f8f5] text-[#52736c]'}`}><ShieldCheck size={13} />{modeNote}</div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-5">
        {data.picks.map((pick) => (
          <article key={pick.ticker} className="rounded-xl border border-[#e2e9e6] bg-white p-4" data-testid={`hsi-${mode}-pick-${pick.rank}`}>
            <div className="flex items-start justify-between gap-2"><div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#203238] font-mono text-xs font-bold text-[#f2c75b]">0{pick.rank}</div><div className={`rounded-full px-2 py-1 font-mono text-[10px] font-bold ${scoreTone(pick.score)}`}>{pick.score.toFixed(1)}</div></div>
            <div className="mt-3 font-mono text-[14px] font-bold text-[#26373c]">{pick.ticker.replace('.HK', '')}</div>
            <div className="mt-1 truncate text-[11px] font-semibold text-[#52676a]">{pick.name}</div>
            <div className="mt-1 text-[10px] text-[#899599]">{pick.sector}</div>
            <div className="mt-3 space-y-1.5 text-[10px] text-[#637477]"><div className="flex justify-between"><span>{isRecovery ? '12M落后度' : isPullback || isLeader ? '12M领先度' : '12M动能'}</span><span className="font-mono">{pick.momentum12m.toFixed(0)}</span></div><div className="flex justify-between"><span>{isRecovery ? '近期改善' : isPullback ? '回檔訊號' : isLeader ? '近6M趨勢' : '6M動能'}</span><span className="font-mono">{pick.momentum6m.toFixed(0)}</span></div>{isPullback && <><div className="flex justify-between"><span>距高位回檔</span><span className="font-mono">{((pick.pullbackDepth ?? 0) * 100).toFixed(1)}%</span></div><div className="flex justify-between"><span>短期轉弱</span><span className="font-mono">{(pick.recentWeakness ?? 0).toFixed(0)}</span></div><div className="flex justify-between"><span>波動放大</span><span className="font-mono">{(pick.volatilityExpansion ?? 0).toFixed(0)}</span></div></>}<div className="flex justify-between"><span>稳定度</span><span className="font-mono">{pick.stability.toFixed(0)}</span></div><div className="flex justify-between"><span>回撤韧性</span><span className="font-mono">{pick.drawdownResilience.toFixed(0)}</span></div></div>
            <p className="mt-3 border-t border-[#eef2f0] pt-3 text-[10px] leading-4 text-[#718184]">{pick.reason}</p>
          </article>
        ))}
      </div>
      <div className={`mt-4 flex items-start gap-2 rounded-xl border px-3.5 py-3 text-[10px] leading-5 ${isLaggard ? 'border-[#eadbd5] bg-[#fff7f4] text-[#786b68]' : isPullback ? 'border-[#eadfbd] bg-[#fffaf0] text-[#786d5c]' : 'border-[#e2e9e6] bg-[#f4f9f7] text-[#637477]'}`}><Sparkles size={13} className="mt-0.5 shrink-0 text-[#d6a132]" /><div><span className="font-bold text-[#52736c]">模型：</span>{data.model}<br /><span className="font-bold text-[#52736c]">限制：</span>{data.limitation}</div></div>
    </section>
  );
}