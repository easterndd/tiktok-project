import { useState, useEffect, useRef, useMemo } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Activity, Bug, CircleAlert, Copy, Download, RefreshCw, Search, Share2, Trash2, X } from 'lucide-react';
import { appKey, appName } from '../lib/app-brand';
import { clearDebugRecords, getDebugEnvironment, getDebugRecords, subscribeDebugRecords, type DebugRecord } from '../lib/analytics';
import { debugErrorZh } from '../lib/debug-error-zh';
import styles from './DebugPage.module.css';
import { debugPanelAvailable } from '../lib/debug-panel';
import { getClientTraceRecords, getClientTraceStatus } from '../lib/client-trace';
import { installDebugConsoleCapture } from '../lib/diagnostics';

type View = 'network' | 'events' | 'console' | 'environment';
type DetailTab = 'overview' | 'headers' | 'payload' | 'response' | 'timing' | 'raw';
const eventLabels: Record<string, string> = {
  app_open: '打开小程序', ad_config: '广告配置', ad_load: '广告加载', ad_show: '广告展示', ad_close: '广告关闭',
  launch_attribution: '启动归因', entry_ad_decision: '入口强弹决定'
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
  if (record.kind === 'console') return value(data.message) || `${value(data.level)} output`;
  return value(data.phase ?? data.kind) || '运行异常';
}

function recordStatus(record: DebugRecord) {
  if (record.kind === 'request') return Number(record.data.statusCode) || 0;
  if (record.kind === 'event') return resultLabels[value(record.data.result)] ?? (value(record.data.result) || '-');
  if (record.kind === 'console') return value(record.data.level).toUpperCase() || 'LOG';
  return '异常';
}

function isFailure(record: DebugRecord) {
  if (record.kind === 'request') return Number(record.data.statusCode) === 0 || Number(record.data.statusCode) >= 400;
  if (record.kind === 'console') return record.data.level === 'error' || record.data.level === 'warn';
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

function ConsoleDetail({ record, tab }: { record: DebugRecord; tab: DetailTab }) {
  if (tab === 'raw') return <div className={styles.detailContent}><h3>脱敏原始记录</h3><JsonView data={record.data} /></div>;
  return <div className={styles.detailContent}>
    <h3>{value(record.data.level).toUpperCase() || 'CONSOLE'} 输出</h3>
    <p className={styles.consoleMessage}>{value(record.data.message) || '无文本内容'}</p>
    <h3>参数</h3><JsonView data={record.data.args} empty="无参数" />
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
  const [feedback, setFeedback] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const [exportText, setExportText] = useState('');
  const [traceStatus, setTraceStatus] = useState(getClientTraceStatus);
  const output = useRef<HTMLTextAreaElement>(null);
  const copyBuffer = useRef<HTMLTextAreaElement>(null);

  useEffect(() => subscribeDebugRecords(() => setRecords(getDebugRecords())), []);
  useEffect(() => {
    installDebugConsoleCapture();
    const timer = window.setInterval(() => setTraceStatus((current) => {
      const next = getClientTraceStatus();
      return current.enabled === next.enabled && current.localOnly === next.localOnly
        && current.traceId === next.traceId && current.pending === next.pending && current.dropped === next.dropped
        ? current : next;
    }), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  if (!debugPanelAvailable()) return <Navigate to="/" replace />;

  const counts = {
    network: records.filter((record) => record.kind === 'request').length,
    events: records.filter((record) => record.kind === 'event').length,
    console: records.filter((record) => record.kind === 'runtime' || record.kind === 'console').length
  };
  const kind = view === 'network' ? 'request' : view === 'events' ? 'event' : 'runtime';
  const normalizedQuery = query.trim().toLowerCase();
  const visible = [...records].reverse().filter((record) => (view === 'console'
    ? record.kind === 'runtime' || record.kind === 'console'
    : record.kind === kind)
    && (!failuresOnly || isFailure(record))
    && (!normalizedQuery || `${recordTitle(record)} ${record.data.level ?? ''} ${record.data.method ?? ''} ${record.data.statusCode ?? ''} ${record.data.errorCode ?? ''} ${errorMessage(record) ?? ''}`.toLowerCase().includes(normalizedQuery)));
  const selected = withChineseError(visible.find((record) => record.id === selectedId) ?? visible[0] ?? { id: 0, at: '', kind, data: {} });
  const hasSelection = selected.id !== 0;
  const exportJson = useMemo(() => JSON.stringify({
    exportedAt: new Date().toISOString(), appKey, appName, traceId: traceStatus.traceId,
    environment: getDebugEnvironment(), records: records.map(withChineseError),
    clientTrace: traceStatus.localOnly ? getClientTraceRecords() : undefined
  }, null, 2), [records, traceStatus]);

  const selectForManualCopy = (message: string, text = exportJson) => {
    setFeedback(message);
    setExportText(text);
    setExportOpen(true);
    window.setTimeout(() => {
      const field = output.current;
      if (!field) return;
      field.focus();
      field.select();
      field.setSelectionRange(0, field.value.length);
    }, 0);
  };

  const copyRecords = async (onlySelected = false) => {
    const text = onlySelected ? JSON.stringify({ ...selected, traceId: traceStatus.traceId }, null, 2) : exportJson;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setFeedback('已复制脱敏记录');
        return;
      }
    } catch { /* Try the WebView copy command before showing selectable text. */ }
    try {
      const field = copyBuffer.current;
      if (field) {
        field.value = text;
        field.focus();
        field.select();
        if (document.execCommand('copy')) {
          setFeedback('已复制脱敏记录');
          return;
        }
      }
    } catch { /* Some WebViews block programmatic clipboard access. */ }
    selectForManualCopy('自动复制不可用，诊断 JSON 已选中，可长按复制。', text);
  };

  const shareRecords = async () => {
    if (!navigator.share) {
      selectForManualCopy('当前环境不支持分享，诊断 JSON 已选中，可长按复制。', exportJson);
      return;
    }
    try {
      await navigator.share({ title: `${appName} diagnostics`, text: exportJson });
      setFeedback('已打开系统分享面板');
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') setFeedback('已取消分享');
      else selectForManualCopy('无法打开分享面板，诊断 JSON 已选中，可长按复制。', exportJson);
    }
  };

  const downloadRecords = () => {
    let url: string | undefined;
    let anchor: HTMLAnchorElement | undefined;
    try {
      url = URL.createObjectURL(new Blob([exportJson], { type: 'application/json;charset=utf-8' }));
      anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${appKey}-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      setFeedback('已请求浏览器下载 JSON；若未保存，可使用分享或复制。');
    } catch {
      selectForManualCopy('当前环境无法下载文件，诊断 JSON 已选中，可长按复制。', exportJson);
    } finally {
      anchor?.remove();
      if (url) window.setTimeout(() => URL.revokeObjectURL(url!), 1_000);
    }
  };

  return <section className={styles.workbench}>
    <header className={styles.titlebar}>
      <div className={styles.identity}><Bug size={18} aria-hidden="true" /><strong>{appName}</strong><span>调试台</span></div>
      {traceStatus.enabled && <div className={styles.traceStatus} title={`Trace ID: ${traceStatus.traceId}`}>Trace <code>{traceStatus.traceId}</code><span>{traceStatus.localOnly ? `仅本机 ${traceStatus.pending}` : `待上传 ${traceStatus.pending}`} · 丢弃 {traceStatus.dropped}</span></div>}
      <div className={styles.actions}>
        <button type="button" onClick={() => setRecords(getDebugRecords())} title="刷新记录" aria-label="刷新记录"><RefreshCw size={17} /></button>
        <button type="button" onClick={() => void copyRecords()} title="复制全部脱敏记录" aria-label="复制全部脱敏记录"><Copy size={17} /></button>
        <button type="button" onClick={() => void shareRecords()} title="分享诊断记录" aria-label="分享诊断记录"><Share2 size={17} /></button>
        <button type="button" onClick={downloadRecords} title="下载诊断 JSON" aria-label="下载诊断 JSON"><Download size={17} /></button>
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
    {feedback && <div className={styles.toast} role="status">{feedback}</div>}
    <textarea ref={copyBuffer} className={styles.copyBuffer} aria-hidden="true" tabIndex={-1} readOnly />
    {view === 'environment' ? <div className={styles.environment}>
      <h2><Activity size={17} aria-hidden="true" /> 运行信息</h2>
      <KeyValues data={{ ...getDebugEnvironment(), ...(traceStatus.enabled ? { traceId: traceStatus.traceId, localOnly: traceStatus.localOnly, pendingTraceRecords: traceStatus.pending, droppedTraceRecords: traceStatus.dropped } : {}) }} />
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
              <span className={styles.nameCell}><span className={styles.method}>{record.kind === 'request' ? value(record.data.method) : record.kind === 'event' ? 'SDK' : record.kind === 'console' ? 'CONSOLE' : 'LOG'}</span><span className={styles.path}>{recordTitle(record)}<small>{timeLabel(record.at)}</small></span></span>
              <span className={`${styles.status} ${isFailure(record) ? styles.failed : styles.ok}`}>{recordStatus(record)}</span>
              <span className={styles.duration}>{record.data.durationMs == null ? '-' : `${record.data.durationMs}ms`}</span>
            </button>)}
          </div>
        </section>
        <section className={styles.inspector} aria-label="记录详情">
          {hasSelection ? <>
            <div className={styles.inspectorHead}>
              <div><span className={styles.inspectorEyebrow}>{selected.kind === 'request' ? value(selected.data.method) : selected.kind === 'event' ? 'SDK EVENT' : selected.kind === 'console' ? `CONSOLE ${value(selected.data.level).toUpperCase()}` : 'RUNTIME'}</span><h2>{recordTitle(selected)}</h2></div>
              <div className={styles.inspectorActions}><span className={`${styles.statusPill} ${isFailure(selected) ? styles.failed : styles.ok}`}>{recordStatus(selected)}</span><button type="button" onClick={() => void copyRecords(true)} title="复制选中记录" aria-label="复制选中记录"><Copy size={16} /></button></div>
            </div>
            <nav className={styles.detailTabs} role="tablist" aria-label="详情视图">
              {(selected.kind === 'request' ? detailTabs : detailTabs.filter((item) => item.key === 'overview' || item.key === 'raw')).map((item) => <button key={item.key} type="button" role="tab" aria-selected={detailTab === item.key} onClick={() => setDetailTab(item.key)}>{item.label}</button>)}
            </nav>
            <div className={styles.detailScroll}>{selected.kind === 'request' ? <RequestDetail record={selected} tab={detailTab} /> : selected.kind === 'console' ? <ConsoleDetail record={selected} tab={detailTab} /> : <EventDetail record={selected} tab={detailTab} />}</div>
          </> : <div className={styles.emptyInspector}><CircleAlert size={22} aria-hidden="true" /><span>暂无选中记录</span></div>}
        </section>
      </div>
    </>}
    {exportOpen && <div className={styles.exportLayer} role="dialog" aria-modal="true" aria-labelledby="export-title">
      <div className={styles.exportPanel}>
        <div className={styles.exportHeading}><h2 id="export-title">诊断记录</h2><button type="button" onClick={() => setExportOpen(false)} aria-label="关闭导出窗口"><X size={18} /></button></div>
        <p>{feedback}</p>
        <textarea ref={output} className={styles.exportOutput} aria-label="可选择的脱敏诊断 JSON" readOnly value={exportText} spellCheck={false} onFocus={(event) => event.currentTarget.select()} />
      </div>
    </div>}
  </section>;
}
