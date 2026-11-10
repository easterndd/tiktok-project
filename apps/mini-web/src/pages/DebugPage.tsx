import { useState, useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Activity, Bug, CircleAlert, Copy, RefreshCw, Search, Trash2, X } from 'lucide-react';
import { appKey, appName } from '../lib/app-brand';
import { clearDebugRecords, getDebugEnvironment, getDebugRecords, subscribeDebugRecords, type DebugRecord } from '../lib/analytics';
import { debugErrorZh } from '../lib/debug-error-zh';
import styles from './DebugPage.module.css';
import { debugPanelAvailable } from '../lib/debug-panel';

type View = 'network' | 'events' | 'console' | 'environment';
type DetailTab = 'overview' | 'headers' | 'payload' | 'response' | 'timing' | 'raw';
const eventLabels: Record<string, string> = {
  app_open: '打开小程序', ad_config: '广告配置', ad_load: '广告加载', ad_show: '广告展示', ad_close: '广告关闭'
};
const resultLabels: Record<string, string> = {
  success: '成功', fail: '失败', timeout: '超时', unsupported: '不支持'
};
const detailTabs: Array<{ key: DetailTab; label: string }> = [
  { key: 'overview', label: '概览' }, { key: 'headers', label: 'Headers' },
  { key: 'payload', label: 'Payload' }, { key: 'response', label: 'Response' },
  { key: 'timing', label: 'Timing' }, { key: 'raw', label: 'Raw' }
];

function value(item: unknown) {
  return item == null ? '' : String(item);
}

function errorMessage(record: DebugRecord) {
  return record.data.errorMsg ?? record.data.error ?? record.data.message;
}

function errorCode(record: DebugRecord) {
  return record.data.errorCode ?? record.data.code;
}

function withChineseError(record: DebugRecord): DebugRecord {
  const errorMsgZh = debugErrorZh(errorCode(record), errorMessage(record), record.data.statusCode, record.data)
    ?? (record.data.result === 'fail' || record.data.result === 'timeout' ? '当前事件失败，但未收到可解释的原始错误；请检查相邻事件和 SDK 回调。' : null);
  return errorMsgZh ? { ...record, data: { ...record.data, errorMsgZh } } : record;
}

function recordTitle(record: DebugRecord) {
  const data = record.data;
  if (record.kind === 'request') return value(data.path) || '/';
  if (record.kind === 'event') return eventLabels[value(data.eventKey)] ?? value(data.eventKey);
  return value(data.phase ?? data.kind) || '运行异常';
}

function recordStatus(record: DebugRecord) {
  if (record.kind === 'request') return Number(record.data.statusCode) || 0;
  if (record.kind === 'event') return resultLabels[value(record.data.result)] ?? (value(record.data.result) || '-');
  return '异常';
}

function isFailure(record: DebugRecord) {
  if (record.kind === 'request') return Number(record.data.statusCode) === 0 || Number(record.data.statusCode) >= 400;
  return record.kind === 'runtime' || record.data.result === 'fail' || record.data.result === 'timeout';
}

function timeLabel(at: string) {
  return new Date(at).toLocaleTimeString('zh-CN', { hour12: false });
}

function KeyValues({ data, empty = '暂无数据' }: { data: unknown; empty?: string }) {
  if (!data || typeof data !== 'object' || Object.keys(data).length === 0) return <p className={styles.emptyDetail}>{empty}</p>;
  return <dl className={styles.keyValues}>{Object.entries(data).map(([key, item]) => <div key={key}><dt>{key}</dt><dd>{typeof item === 'object' && item !== null ? <code>{JSON.stringify(item)}</code> : value(item)}</dd></div>)}</dl>;
}

function JsonView({ data, empty = '暂无数据' }: { data: unknown; empty?: string }) {
  if (data === undefined || data === null) return <p className={styles.emptyDetail}>{empty}</p>;
  return <pre className={styles.jsonView}>{JSON.stringify(data, null, 2)}</pre>;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function RequestDetail({ record, tab }: { record: DebugRecord; tab: DetailTab }) {
  const data = record.data;
  if (tab === 'headers') return <div className={styles.detailContent}>
    <h3>请求头</h3><KeyValues data={data.requestHeaders} empty="未捕获请求头" />
    <h3>响应头</h3><KeyValues data={data.responseHeaders} empty="浏览器未提供可读取的响应头" />
  </div>;
  if (tab === 'payload') return <div className={styles.detailContent}>
    <h3>查询参数</h3><KeyValues data={data.queryParams} empty="无查询参数" />
    <h3>请求体</h3><JsonView data={data.requestBody} empty="无请求体" />
  </div>;
  if (tab === 'response') return <div className={styles.detailContent}>
    <h3>响应内容</h3><JsonView data={data.responseBody} empty="没有可读取的响应内容" />
  </div>;
  if (tab === 'timing') return <div className={styles.detailContent}>
    <h3>请求耗时</h3><KeyValues data={{ startedAt: data.startedAt ?? '-', completedAt: record.at, totalDurationMs: data.durationMs ?? '-', serverTiming: data.serverTiming ?? '未返回' }} />
  </div>;
  if (tab === 'raw') return <div className={styles.detailContent}><h3>脱敏原始记录</h3><JsonView data={data} /></div>;
  return <div className={styles.detailContent}>
    <h3>请求信息</h3>
    <KeyValues data={{ 'Request URL': data.url ?? data.path, 'Request Method': data.method, 'Status Code': Number(data.statusCode) || '无 HTTP 响应', 'Status Text': data.statusText ?? '-', 'Duration': data.durationMs == null ? '-' : `${data.durationMs} ms`, 'Request ID': data.requestId ?? '-', 'Error Code': data.errorCode ?? '-', 'Content Type': data.contentType ?? '-', 'Content Length': data.contentLength ?? '-', 'Retry-After': data.retryAfter ?? '-', 'Rate Limit Remaining': data.rateLimitRemaining ?? '-' }} />
    {data.errorMsgZh != null && <div className={styles.diagnostic}><strong>中文排查说明</strong><p>{value(data.errorMsgZh)}</p></div>}
    {errorMessage(record) != null && <div className={styles.rawError}><strong>原始错误</strong><p>{value(errorMessage(record))}</p></div>}
    {(data.crossOrigin != null || data.timedOut != null) && <><h3>连接信息</h3><KeyValues data={{ pageOrigin: data.pageOrigin, apiOrigin: data.apiOrigin, crossOrigin: data.crossOrigin, preflightRequired: data.preflightRequired, browserOnline: data.browserOnline, timedOut: data.timedOut, aborted: data.aborted }} /></>}
  </div>;
}

function EventDetail({ record, tab }: { record: DebugRecord; tab: DetailTab }) {
  const data = record.data;
  const sdkCallback = objectValue(data.sdkCallback) ?? objectValue(objectValue(data.metadata)?.sdkCallback);
  if (tab === 'raw') return <div className={styles.detailContent}><h3>脱敏原始记录</h3><JsonView data={data} /></div>;
  return <div className={styles.detailContent}>
    <h3>{record.kind === 'event' ? '广告与应用事件' : '运行异常'}</h3>
    <KeyValues data={{ event: data.eventKey ?? data.kind ?? '-', phase: data.phase ?? '-', result: data.result ?? '-', adSeq: data.adSeq ?? '-', placementId: data.placementId ?? '-', shouldShow: data.shouldShow ?? '-', isEnded: data.isEnded ?? '-', durationMs: data.durationMs ?? '-', releaseId: data.releaseId ?? '-', requestId: data.requestId ?? '-' }} />
    {data.errorMsgZh != null && <div className={styles.diagnostic}><strong>中文排查说明</strong><p>{value(data.errorMsgZh)}</p></div>}
    {(errorCode(record) != null || errorMessage(record) != null) && <><h3>SDK / 接口原始错误</h3><KeyValues data={{ errorCode: errorCode(record) ?? '-', subErrorCode: data.subErrorCode ?? '-', errorMsg: errorMessage(record) ?? '-' }} /></>}
    {data.errorExtra != null && <><h3>附加信息</h3><JsonView data={data.errorExtra} /></>}
    {sdkCallback && <><h3>SDK 原始回调</h3><KeyValues data={{ name: sdkCallback.name ?? '-', capturedAt: sdkCallback.capturedAt ?? '-' }} /><JsonView data={sdkCallback.payload} empty="此回调没有携带参数" /></>}
  </div>;
}

export function DebugPage() {
  const navigate = useNavigate();
  const [records, setRecords] = useState(getDebugRecords);
  const [view, setView] = useState<View>('network');
  const [detailTab, setDetailTab] = useState<DetailTab>('overview');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [failuresOnly, setFailuresOnly] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => subscribeDebugRecords(() => setRecords(getDebugRecords())), []);
  if (!debugPanelAvailable()) return <Navigate to="/" replace />;

  const counts = {
    network: records.filter((record) => record.kind === 'request').length,
    events: records.filter((record) => record.kind === 'event').length,
    console: records.filter((record) => record.kind === 'runtime').length
  };
  const kind = view === 'network' ? 'request' : view === 'events' ? 'event' : 'runtime';
  const normalizedQuery = query.trim().toLowerCase();
  const visible = [...records].reverse().filter((record) => record.kind === kind
    && (!failuresOnly || isFailure(record))
    && (!normalizedQuery || `${recordTitle(record)} ${record.data.method ?? ''} ${record.data.statusCode ?? ''} ${record.data.errorCode ?? ''} ${errorMessage(record) ?? ''}`.toLowerCase().includes(normalizedQuery)));
  const selected = withChineseError(visible.find((record) => record.id === selectedId) ?? visible[0] ?? { id: 0, at: '', kind, data: {} });
  const hasSelection = selected.id !== 0;

  const copyRecords = async (onlySelected = false) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(onlySelected ? selected : { appKey, appName, environment: getDebugEnvironment(), records: records.map(withChineseError) }, null, 2));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch { /* Clipboard access is optional in a WebView. */ }
  };

  return <section className={styles.workbench}>
    <header className={styles.titlebar}>
      <div className={styles.identity}><Bug size={18} aria-hidden="true" /><strong>{appName}</strong><span>调试台</span></div>
      <div className={styles.actions}>
        <button type="button" onClick={() => setRecords(getDebugRecords())} title="刷新记录" aria-label="刷新记录"><RefreshCw size={17} /></button>
        <button type="button" onClick={() => void copyRecords()} title="复制全部脱敏记录" aria-label="复制全部脱敏记录"><Copy size={17} /></button>
        <button type="button" onClick={() => { clearDebugRecords(); setRecords([]); setSelectedId(null); }} title="清空记录" aria-label="清空记录"><Trash2 size={17} /></button>
        <button type="button" onClick={() => window.history.length > 1 ? navigate(-1) : navigate('/')} title="关闭调试台" aria-label="关闭调试台"><X size={18} /></button>
      </div>
    </header>
    <nav className={styles.mainTabs} role="tablist" aria-label="调试视图">
      {([
        ['network', 'Network', counts.network], ['events', 'Ads & Events', counts.events],
        ['console', 'Console', counts.console], ['environment', 'Environment', null]
      ] as const).map(([key, label, count]) => <button key={key} type="button" role="tab" aria-selected={view === key} onClick={() => { setView(key); setSelectedId(null); setDetailTab('overview'); }}>{label}{count !== null && <span>{count}</span>}</button>)}
    </nav>
    {copied && <div className={styles.toast} role="status">已复制脱敏记录</div>}
    {view === 'environment' ? <div className={styles.environment}>
      <h2><Activity size={17} aria-hidden="true" /> 运行信息</h2>
      <KeyValues data={getDebugEnvironment()} />
    </div> : <>
      <div className={styles.toolbar}>
        <label className={styles.search}><Search size={16} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="筛选路径、状态或错误码" aria-label="筛选记录" /></label>
        <div className={styles.segment} aria-label="状态筛选"><button type="button" aria-pressed={!failuresOnly} onClick={() => setFailuresOnly(false)}>全部</button><button type="button" aria-pressed={failuresOnly} onClick={() => setFailuresOnly(true)}>异常</button></div>
        <span className={styles.count}>{visible.length} 条</span>
      </div>
      <div className={styles.workspace}>
        <section className={styles.requestList} aria-label="记录列表">
          <div className={styles.columnHead}><span>名称</span><span>状态</span><span>耗时</span></div>
          <div className={styles.rows}>
            {visible.length === 0 ? <p className={styles.empty}>暂无记录</p> : visible.map((record) => <button key={record.id} type="button" className={`${styles.row} ${selected.id === record.id ? styles.selected : ''}`} onClick={() => { setSelectedId(record.id); setDetailTab('overview'); }} aria-current={selected.id === record.id ? 'true' : undefined}>
              <span className={styles.nameCell}><span className={styles.method}>{record.kind === 'request' ? value(record.data.method) : record.kind === 'event' ? 'SDK' : 'LOG'}</span><span className={styles.path}>{recordTitle(record)}<small>{timeLabel(record.at)}</small></span></span>
              <span className={`${styles.status} ${isFailure(record) ? styles.failed : styles.ok}`}>{recordStatus(record)}</span>
              <span className={styles.duration}>{record.data.durationMs == null ? '-' : `${record.data.durationMs}ms`}</span>
            </button>)}
          </div>
        </section>
        <section className={styles.inspector} aria-label="记录详情">
          {hasSelection ? <>
            <div className={styles.inspectorHead}>
              <div><span className={styles.inspectorEyebrow}>{selected.kind === 'request' ? value(selected.data.method) : selected.kind === 'event' ? 'SDK EVENT' : 'RUNTIME'}</span><h2>{recordTitle(selected)}</h2></div>
              <div className={styles.inspectorActions}><span className={`${styles.statusPill} ${isFailure(selected) ? styles.failed : styles.ok}`}>{recordStatus(selected)}</span><button type="button" onClick={() => void copyRecords(true)} title="复制选中记录" aria-label="复制选中记录"><Copy size={16} /></button></div>
            </div>
            <nav className={styles.detailTabs} role="tablist" aria-label="详情视图">
              {(selected.kind === 'request' ? detailTabs : detailTabs.filter((item) => item.key === 'overview' || item.key === 'raw')).map((item) => <button key={item.key} type="button" role="tab" aria-selected={detailTab === item.key} onClick={() => setDetailTab(item.key)}>{item.label}</button>)}
            </nav>
            <div className={styles.detailScroll}>{selected.kind === 'request' ? <RequestDetail record={selected} tab={detailTab} /> : <EventDetail record={selected} tab={detailTab} />}</div>
          </> : <div className={styles.emptyInspector}><CircleAlert size={22} aria-hidden="true" /><span>暂无选中记录</span></div>}
        </section>
      </div>
    </>}
  </section>;
}
