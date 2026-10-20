import { Activity, BarChart3, CalendarDays } from 'lucide-react';
import type { ReactNode } from 'react';

export function Metric({ label, value, change, icon: Icon, tone }: { label: string; value: string; change: string; icon: typeof Activity; tone: string }) {
  return <article className="metric"><div className={`metric-icon ${tone}`}><Icon size={19} /></div><div><p>{label}</p><strong>{value}</strong><small>{change}</small></div></article>;
}

export function BarList({ title, items, color = 'pink' }: { title: string; items: { label: string; value: number }[]; color?: string }) {
  const max = Math.max(...items.map((item) => item.value), 1);
  return <section className="bar-list"><div className="mini-heading"><strong>{title}</strong><BarChart3 size={16} /></div>{items.length ? items.map((item) => <div className="bar-row" key={item.label}><span>{item.label}</span><i><b className={color} style={{ width: `${Math.max(item.value / max * 100, item.value ? 5 : 0)}%` }} /></i><em>{item.value}</em></div>) : <p className="empty-copy">暂无数据</p>}</section>;
}

export function DailyBars({ title, items }: { title: string; items: { date: string; count: number }[] }) {
  const max = Math.max(...items.map((item) => item.count), 1);
  const visible = items.length > 14 ? items.filter((_, index) => index % Math.ceil(items.length / 14) === 0) : items;
  return <section className="daily-chart"><div className="mini-heading"><strong>{title}</strong><CalendarDays size={16} /></div><div className="daily-bars">{visible.map((item) => <div className="daily-bar" key={item.date} title={`${item.date}: ${item.count}`}><i style={{ height: `${Math.max(item.count / max * 100, item.count ? 8 : 2)}%` }} /><small>{item.date.slice(5)}</small></div>)}</div></section>;
}

export function Status({ value }: { value: string }) {
  const labels: Record<string, string> = {
    DRAFT: '草稿', REVIEWING: '审核中', ONLINE: '已上线', OFFLINE: '已下线', REJECTED: '已驳回',
    UPLOADING: '上传中', READY: '已就绪', PENDING: '待处理', PROCESSING: '处理中', SUCCEEDED: '已完成',
    FAILED: '失败', ERROR: '错误', CONFLICT: '结果未知', ACTIVE: '进行中', COMPLETED: '已完成', EXPIRED: '已过期',
    AUTHORIZED: '已授权', AUTHORIZING: '授权与映射中', REVOKED: '已撤销', REVOKING: '撤销中', NOT_AUTHORIZED: '未授权', ACCESS_ERROR: '未授权访问'
  };
  const tone = value === 'SUCCEEDED' || value === 'ONLINE' || value === 'READY' || value === 'COMPLETED' || value === 'AUTHORIZED' ? 'green' : value === 'FAILED' || value === 'ERROR' || value === 'OFFLINE' || value === 'REJECTED' || value === 'CONFLICT' || value === 'ACCESS_ERROR' ? 'pink' : 'yellow';
  return <span className={`status ${tone}`}><i />{labels[value] ?? value}</span>;
}

export function Panel({ title, description, action, children }: { title: string; description?: string; action?: ReactNode; children: ReactNode }) {
  return <section className="panel"><div className="panel-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>{children}</section>;
}
