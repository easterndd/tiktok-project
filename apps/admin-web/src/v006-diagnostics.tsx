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
