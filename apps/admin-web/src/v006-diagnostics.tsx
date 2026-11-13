import { useEffect, useState, type FormEvent } from 'react';
import { Panel } from './dashboard-ui';

type Api = <T>(path: string, options?: RequestInit) => Promise<T>;
type AdSummary = {
  releaseId: string; platform: string; strategyVariant: string; adType: string; placementId: string; placementRole: string;
  firstAttempts: number; backupAttempts: number; showSuccesses: number; showFailures: number;
  closeOperations: number; completedOperations: number; error50008: number; error11006: number;
  callbackEligibleEvents: number; sdkCallbackEvents: number;
};
type AdError = {
  releaseId: string; platform: string; strategyVariant: string; adType: string; placementId: string; adPhase: string;
  errorOrigin: string; errorCode: string; subErrorCode: string; operations: number; events: number;
};
type PlayerSummary = {
  releaseId: string; platform: string; starts: number; firstFrames: number; errors: number;
  preloadHits: number; preloadObservations: number; firstFrameP50Ms: number | null; firstFrameP95Ms: number | null;
};
type PlayerError = { releaseId: string; platform: string; stage: string; errorCode: string; operations: number; events: number };
type DiagnosticResult<T, E> = { from: string; to: string; summary: T[]; errors: E[] };

function useDiagnostics<T, E>(api: Api, path: string, releaseId: string, hours: number, platform: string, operationId: string) {
  const [result, setResult] = useState<DiagnosticResult<T, E> | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ hours: String(hours) });
    if (releaseId.includes('-v006-')) params.set('releaseId', releaseId);
    if (platform) params.set('platform', platform);
    if (operationId) params.set('operationId', operationId);
    setLoading(true);
    void api<DiagnosticResult<T, E>>(path + '?' + params, { signal: controller.signal })
      .then((value) => { if (!controller.signal.aborted) { setResult(value); setError(''); setLoading(false); } })
      .catch((cause) => { if (!controller.signal.aborted) { setError(cause instanceof Error ? cause.message : '读取诊断数据失败'); setLoading(false); } });
    return () => controller.abort();
  }, [api, path, releaseId, hours, platform, operationId]);
  return { result, error, loading };
}

function DiagnosticsControls({ hours, setHours, platform, setPlatform, operationId, setOperationId }: {
  hours: number; setHours: (value: number) => void; platform: string; setPlatform: (value: string) => void;
  operationId: string; setOperationId: (value: string) => void;
}) {
  const [draft, setDraft] = useState(operationId);
  const search = (event: FormEvent) => { event.preventDefault(); setOperationId(draft.trim()); };
  return <form className="diagnostic-controls" onSubmit={search}>
    <label>时间范围<select value={hours} onChange={(event) => setHours(Number(event.target.value))}><option value={24}>近 24 小时</option><option value={72}>近 72 小时</option></select></label>
    <label>系统<select value={platform} onChange={(event) => setPlatform(event.target.value)}><option value="">全部</option><option value="ios">iOS</option><option value="android">Android</option><option value="unknown">未知</option></select></label>
    <label>操作 ID<input value={draft} maxLength={128} onChange={(event) => setDraft(event.target.value)} placeholder="可选，定位一次操作" /></label>
    <button className="secondary" type="submit">查询</button>
  </form>;
}

const rate = (numerator: number, denominator: number) => denominator ? (numerator / denominator * 100).toFixed(1) + '%' : '—';
const duration = (value: number | null) => value === null ? '—' : Math.round(value) + ' ms';

export function V006AdDiagnostics({ api, releaseId }: { api: Api; releaseId: string }) {
  const [hours, setHours] = useState(24);
  const [platform, setPlatform] = useState('');
  const [operationId, setOperationId] = useState('');
  const { result, error, loading } = useDiagnostics<AdSummary, AdError>(api, '/admin/analytics/ad-diagnostics', releaseId, hours, platform, operationId);
  return <Panel title="v0.0.6 广告诊断" description="按展示操作去重。主位首次尝试与备用位尝试分开统计；回调覆盖率只针对 onError/onClose 样本。">
    <DiagnosticsControls {...{ hours, setHours, platform, setPlatform, operationId, setOperationId }} />
    {error && <p className="diagnostic-message" role="alert">{error}</p>}
    {loading && <p className="diagnostic-message">正在读取诊断数据...</p>}
    {result && <p className="diagnostic-message">入库时间：{new Date(result.from).toLocaleString('zh-CN')} 至 {new Date(result.to).toLocaleString('zh-CN')}。当前策略 release：{releaseId}。</p>}
    {result && <div className="table-wrap"><table className="diagnostic-table"><thead><tr><th>Release / 系统</th><th>策略 / 广告位</th><th>展示尝试</th><th>成功 / 失败</th><th>50008 / 11006</th><th>关闭 / 完播</th><th>原始回调</th></tr></thead><tbody>
      {result.summary.map((item, index) => {
        const attempts = item.firstAttempts + item.backupAttempts;
        return <tr key={item.releaseId + item.platform + item.placementId + item.strategyVariant + index}>
          <td><strong>{item.releaseId}</strong><br />{item.platform}</td>
          <td>{item.adType} · {item.strategyVariant}<br />{item.placementRole} · <code>{item.placementId}</code></td>
          <td>{attempts} 次<br /><small>主位 {item.firstAttempts} · 备用 {item.backupAttempts}</small></td>
          <td>{item.showSuccesses} / {item.showFailures}<br /><small>成功率 {rate(item.showSuccesses, attempts)}</small></td>
          <td>{item.error50008} / {item.error11006}<br /><small>占尝试 {rate(item.error50008, attempts)} / {rate(item.error11006, attempts)}</small></td>
          <td>{item.closeOperations} / {item.completedOperations}</td>
          <td>{item.sdkCallbackEvents} / {item.callbackEligibleEvents}<br /><small>{rate(item.sdkCallbackEvents, item.callbackEligibleEvents)}</small></td>
        </tr>;
      })}
      {!result.summary.length && <tr><td colSpan={7}>暂无带操作 ID 的广告事件</td></tr>}
    </tbody></table></div>}
    {result && <div className="table-wrap"><table className="diagnostic-table"><thead><tr><th>错误阶段</th><th>系统 / 策略</th><th>广告位</th><th>原始码 / 子码</th><th>独立操作 / 事件</th></tr></thead><tbody>
      {result.errors.map((item, index) => <tr key={item.releaseId + item.platform + item.adPhase + item.errorCode + index}>
        <td>{item.adType} · {item.adPhase} · {item.errorOrigin}</td><td>{item.platform} · {item.strategyVariant}</td>
        <td><code>{item.placementId}</code></td><td>{item.errorCode} / {item.subErrorCode}</td><td>{item.operations} / {item.events}</td>
      </tr>)}
      {!result.errors.length && <tr><td colSpan={5}>暂无错误记录</td></tr>}
    </tbody></table></div>}
  </Panel>;
}

export function V006PlayerDiagnostics({ api, releaseId }: { api: Api; releaseId: string }) {
  const [hours, setHours] = useState(24);
  const [platform, setPlatform] = useState('');
  const [operationId, setOperationId] = useState('');
  const { result, error, loading } = useDiagnostics<PlayerSummary, PlayerError>(api, '/admin/analytics/player-diagnostics', releaseId, hours, platform, operationId);
  return <Panel title="v0.0.6 播放诊断" description="按播放器操作去重，区分启动、首帧、错误与预加载命中。">
    <DiagnosticsControls {...{ hours, setHours, platform, setPlatform, operationId, setOperationId }} />
    {error && <p className="diagnostic-message" role="alert">{error}</p>}
    {loading && <p className="diagnostic-message">正在读取诊断数据...</p>}
    {result && <div className="table-wrap"><table className="diagnostic-table"><thead><tr><th>Release / 系统</th><th>启动 / 首帧</th><th>首帧率</th><th>错误操作</th><th>首帧 P50 / P95</th><th>预加载命中</th></tr></thead><tbody>
      {result.summary.map((item) => <tr key={item.releaseId + item.platform}>
        <td><strong>{item.releaseId}</strong><br />{item.platform}</td><td>{item.starts} / {item.firstFrames}</td>
        <td>{rate(item.firstFrames, item.starts)}</td><td>{item.errors}</td>
        <td>{duration(item.firstFrameP50Ms)} / {duration(item.firstFrameP95Ms)}</td>
        <td>{item.preloadHits} / {item.preloadObservations}</td>
      </tr>)}
      {!result.summary.length && <tr><td colSpan={6}>暂无带操作 ID 的播放事件</td></tr>}
    </tbody></table></div>}
    {result && <div className="table-wrap"><table className="diagnostic-table"><thead><tr><th>Release / 系统</th><th>失败阶段</th><th>错误码</th><th>独立操作 / 事件</th></tr></thead><tbody>
      {result.errors.map((item, index) => <tr key={item.releaseId + item.platform + item.stage + item.errorCode + index}>
        <td>{item.releaseId} · {item.platform}</td><td>{item.stage}</td><td>{item.errorCode}</td><td>{item.operations} / {item.events}</td>
      </tr>)}
      {!result.errors.length && <tr><td colSpan={4}>暂无播放错误</td></tr>}
    </tbody></table></div>}
  </Panel>;
}

type TraceSession = {
  id: string; releaseId: string; platform: string | null; userId: string | null;
  startedAt: string; lastEventAt: string; _count: { records: number };
};
type TraceRecord = {
  id: string; seq: number; kind: string; phase: string | null; eventAt: string; receivedAt: string;
  operationId: string | null; sessionId: string | null; requestId: string | null;
  placementId: string | null; payload: unknown; truncated: boolean;
  errorCode: string | null; subErrorCode: string | null;
};
type TraceList = { items: TraceSession[]; nextCursor: string | null };
type TraceDetail = { session: TraceSession | null; items: TraceRecord[]; nextCursor: string | null };

export function V006ClientTraces({ api, releaseId }: { api: Api; releaseId: string }) {
  const [draft, setDraft] = useState({ traceId: '', operationId: '', requestId: '', sessionId: '', errorCode: '', placementId: '', platform: '' });
  const [filters, setFilters] = useState(draft);
  const [hours, setHours] = useState(24);
  const [list, setList] = useState<TraceList | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<TraceDetail | null>(null);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const query = new URLSearchParams({ hours: String(hours) });
  if (releaseId.includes('-v006-')) query.set('releaseId', releaseId);
  for (const [key, value] of Object.entries(filters)) if (value.trim()) query.set(key, value.trim());

  useEffect(() => {
    const controller = new AbortController();
    setList(null);
    void api<TraceList>(`/admin/client-traces?${query}`, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) { setList(result); setError(''); } })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => controller.abort();
  }, [api, hours, releaseId, filters]);

  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    const controller = new AbortController();
    setDetail(null);
    void api<TraceDetail>(`/admin/client-traces/${encodeURIComponent(selectedId)}/records`, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) { setDetail(result); setError(''); } })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause)); });
    return () => controller.abort();
  }, [api, selectedId]);

  const loadMore = async () => {
    if (!selectedId || !detail?.nextCursor) return;
    try {
      const next = await api<TraceDetail>(`/admin/client-traces/${encodeURIComponent(selectedId)}/records?cursor=${encodeURIComponent(detail.nextCursor)}`);
      setDetail((current) => current?.session?.id === selectedId ? { ...current, items: [...current.items, ...next.items], nextCursor: next.nextCursor } : current);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const loadMoreSessions = async () => {
    if (!list?.nextCursor) return;
    try {
      const params = new URLSearchParams(query);
      params.set('cursor', list.nextCursor);
      const next = await api<TraceList>(`/admin/client-traces?${params}`);
      setList((current) => current ? { items: [...current.items, ...next.items], nextCursor: next.nextCursor } : current);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const exportTrace = async () => {
    if (!selectedId) return;
    setExporting(true);
    try {
      let page = await api<TraceDetail>(`/admin/client-traces/${encodeURIComponent(selectedId)}/records`);
      const items = [...page.items];
      while (page.nextCursor && items.length < 10_000) {
        page = await api<TraceDetail>(`/admin/client-traces/${encodeURIComponent(selectedId)}/records?cursor=${encodeURIComponent(page.nextCursor)}`);
        items.push(...page.items);
      }
      const blob = new Blob([JSON.stringify({ session: page.session, records: items, hasMore: Boolean(page.nextCursor) }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `client-trace-${selectedId}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setExporting(false); }
  };

  return <Panel title="客户端原始诊断" description="SDK 可见回调与业务 HTTP 请求按 trace ID 串联；截断记录会单独标记。">
    <form className="diagnostic-controls" onSubmit={(event) => { event.preventDefault(); setFilters({ ...draft }); }}>
      <label>时间范围<select value={hours} onChange={(event) => setHours(Number(event.target.value))}><option value={24}>近 24 小时</option><option value={72}>近 72 小时</option><option value={168}>近 7 天</option></select></label>
      <label>系统<select value={draft.platform} onChange={(event) => setDraft((value) => ({ ...value, platform: event.target.value }))}><option value="">全部</option><option value="ios">iOS</option><option value="android">Android</option><option value="unknown">未知</option></select></label>
      {(['traceId', 'operationId', 'requestId', 'sessionId', 'errorCode', 'placementId'] as const).map((key) => <label key={key}>{key}<input value={draft[key]} maxLength={128} onChange={(event) => setDraft((value) => ({ ...value, [key]: event.target.value }))} /></label>)}
      <button className="secondary" type="submit">查询</button>
    </form>
    {error && <p className="diagnostic-message" role="alert">{error}</p>}
    {!list && !error && <p className="diagnostic-message">正在读取诊断会话...</p>}
    {list && <div className="table-wrap"><table className="diagnostic-table"><thead><tr><th>时间</th><th>Trace ID</th><th>系统 / 记录</th><th>操作</th></tr></thead><tbody>
      {list.items.map((item) => <tr key={item.id}><td>{new Date(item.lastEventAt).toLocaleString('zh-CN')}</td><td><code>{item.id}</code><br /><small>{item.releaseId}</small></td><td>{item.platform ?? 'unknown'} · {item._count.records} 条</td><td><button className="secondary" type="button" onClick={() => setSelectedId(item.id)}>查看</button></td></tr>)}
      {!list.items.length && <tr><td colSpan={4}>暂无客户端原始诊断</td></tr>}
    </tbody></table></div>}
    {list?.nextCursor && <p className="diagnostic-message"><button className="secondary" type="button" onClick={() => void loadMoreSessions()}>加载更多会话</button></p>}
    {selectedId && <div className="trace-timeline"><div className="trace-heading"><strong>Trace <code>{selectedId}</code></strong><button className="secondary" type="button" disabled={exporting} onClick={() => void exportTrace()}>{exporting ? '导出中...' : '导出脱敏 JSON'}</button></div>
      {!detail && !error && <p>正在读取时间线...</p>}
      {detail?.items.map((item) => <details key={item.id} className="trace-record"><summary><time>{new Date(item.eventAt).toLocaleTimeString('zh-CN', { hour12: false })}</time> {item.kind} · {item.phase} {item.placementId && <code>{item.placementId}</code>} {item.errorCode && <strong>错误 {item.errorCode}{item.subErrorCode ? ` / ${item.subErrorCode}` : ''}</strong>} {item.truncated && <strong>已截断</strong>}</summary><p>序号 {item.seq} · 请求 {item.requestId ?? '-'} · 操作 {item.operationId ?? '-'} · 会话 {item.sessionId ?? '-'}</p><pre>{JSON.stringify(item.payload, null, 2)}</pre></details>)}
      {detail?.nextCursor && <button className="secondary" type="button" onClick={() => void loadMore()}>加载更多记录</button>}
    </div>}
  </Panel>;
}

type LaunchAttributionItem = {
  id: string; launchId: string; launchRef: string; releaseId: string; userId: string;
  collectionStatus: string; localAttributionStatus: string; attributionReason: string;
  platformAttributionStatus: string; signalSummary: unknown; createdAt: string;
  decision: null | { decision: string; reason: string; policyVersion: number | null; requiredCount: number | null; countMode: string | null; requestId: string; decidedAt: string };
};

export function V006LaunchAttributionDiagnostics({ api, releaseId }: { api: Api; releaseId: string }) {
  const [launchId, setLaunchId] = useState('');
  const [items, setItems] = useState<LaunchAttributionItem[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const search = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ releaseId });
    if (launchId.trim()) params.set('launchId', launchId.trim());
    try {
      const result = await api<{ items: LaunchAttributionItem[] }>(`/admin/launch-attribution?${params}`);
      setItems(result.items);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '读取启动归因失败'); }
    finally { setLoading(false); }
  };
  return <Panel title="启动归因与入口豁免" description="查看本次启动的归因结论，以及入口强弹是否因未归因而跳过。">
    <form className="diagnostic-controls" onSubmit={(event) => void search(event)}>
      <label>Launch ID<input value={launchId} maxLength={64} onChange={(event) => setLaunchId(event.target.value)} placeholder="留空查询当前 release" /></label>
      <button className="secondary" type="submit" disabled={loading}>{loading ? '查询中...' : '查询'}</button>
    </form>
    {error && <p className="diagnostic-message" role="alert">{error}</p>}
    {items.length > 0 && <div className="table-wrap"><table className="diagnostic-table"><thead><tr><th>启动时间 / ID</th><th>参数采集</th><th>本地归因</th><th>平台归因</th><th>入口强弹决定</th><th>信号摘要</th></tr></thead><tbody>
      {items.map((item) => <tr key={item.launchRef}><td>{new Date(item.createdAt).toLocaleString('zh-CN')}<br /><code>{item.launchId}</code></td><td>{item.collectionStatus}<br /><small>{item.releaseId}</small></td><td>{item.localAttributionStatus}<br /><small>{item.attributionReason}</small></td><td>{item.platformAttributionStatus}</td><td>{item.decision ? `${item.decision.decision} · ${item.decision.reason}` : '未决策'}{item.decision && <><br /><small>requestId {item.decision.requestId}</small></>}</td><td><code>{JSON.stringify(item.signalSummary)}</code></td></tr>)}
    </tbody></table></div>}
    {!loading && !error && items.length === 0 && <p className="diagnostic-message">当前 release 暂无启动归因记录。</p>}
  </Panel>;
}
