import { CircleAlert, RefreshCw } from 'lucide-react';
import { Panel } from './dashboard-ui';

export type Health = {
  generatedAt: string; windowStart: string;
  counts: { adFailures: number; playbackErrors: number; uploadFailures: number; platformFailures: number; startupErrors: number; apiErrors: number; scriptErrors: number; clientAdErrors: number };
  recent: { kind: string; createdAt: string; occurredAt?: string | null; message: string; releaseId?: string; path?: string; requestId?: string; statusCode?: number; durationMs?: number }[];
};
export function HealthPanel({ health, minutes, onMinutes, onRefresh, error }: {
  health: Health | null; minutes: number; onMinutes: (value: number) => void; onRefresh: () => void; error?: string | null;
}) {
  const metrics = health ? [
    ['启动异常', health.counts.startupErrors], ['接口 / 剧集加载失败', health.counts.apiErrors],
    ['脚本异常', health.counts.scriptErrors], ['广告失败事件', health.counts.adFailures],
    ['广告客户端诊断', health.counts.clientAdErrors], ['播放错误事件', health.counts.playbackErrors],
    ['上传失败', health.counts.uploadFailures], ['平台任务异常', health.counts.platformFailures]
  ] as const : [];
  return <Panel title="小程序运行异常" description={health ? `服务端接收时间窗口 · 更新于 ${new Date(health.generatedAt).toLocaleString('zh-CN')} · 页面可见时每 30 秒刷新` : '正在读取异常记录'} action={<div className="header-actions"><select aria-label="异常时间范围" value={minutes} onChange={(e) => onMinutes(Number(e.target.value))}><option value={30}>最近 30 分钟</option><option value={1440}>最近 24 小时</option></select><button className="secondary" type="button" onClick={onRefresh}><RefreshCw size={14} />刷新</button></div>}>
    <p className="form-help">客户端诊断用于定位故障，可能与广告或播放事件重复。新诊断需使用更新后的构建包；网络中断期间可能无法上报。</p>
    {health ? <><div className="health-metrics">{metrics.map(([label, count]) => <div key={label}><strong>{count ?? 0}</strong><span>{label}</span></div>)}</div><div className="compact-list">{health.recent.map((item, i) => <div className="compact-row" key={`${item.createdAt}-${i}`}><CircleAlert size={16} /><span><strong>{item.kind} · {new Date(item.createdAt).toLocaleString('zh-CN')}</strong><small>{item.message}</small><small>{[item.releaseId && `构建包 ${item.releaseId}`, item.path, item.statusCode != null && `HTTP ${item.statusCode}`, item.durationMs != null && `${item.durationMs} ms`, item.requestId && `请求 ${item.requestId}`].filter(Boolean).join(' · ')}</small>{item.occurredAt && <small>客户端发生时间：{new Date(item.occurredAt).toLocaleString('zh-CN')}</small>}</span></div>)}{!health.recent.length && <p className="empty-copy">所选时间范围没有收到异常记录</p>}</div></> : <p className="empty-copy">{error ?? '正在加载异常监控...'}</p>}
  </Panel>;
}
