import assert from 'node:assert/strict';
import { it } from 'node:test';
import { debugErrorZh } from '../src/lib/debug-error-zh.ts';

it('explains the IAA environment failure without blaming the placement', () => {
  const message = debugErrorZh('101150000', '50008: [Client] env check failed, current env is unavailable for iaa');
  assert.match(message, /环境检查未通过/);
  assert.match(message, /不能判定广告位 ID 有误/);
});

it('distinguishes network failures and server responses', () => {
  assert.match(debugErrorZh(undefined, 'Failed to fetch', 0), /缺少跨域和连接证据/);
  assert.match(debugErrorZh(undefined, 'HTTP 503', 503), /服务返回 503/);
  assert.match(debugErrorZh(undefined, 'HTTP 404', 404, { path: '/analytics/events' }), /本批埋点未写入数据库/);
  assert.match(debugErrorZh(undefined, 'Not found', 404, { path: '/ui-components' }), /请求路径、目标服务和部署版本/);
  assert.match(debugErrorZh(undefined, 'Bad gateway', 502), /Caddy 到 API 上游/);
});

it('uses request evidence without claiming a browser-hidden root cause', () => {
  const crossOrigin = debugErrorZh(undefined, 'Failed to fetch', 0, {
    pageOrigin: 'http://127.0.0.1:5178', apiOrigin: 'https://api.evergreenprosper.com', crossOrigin: true, preflightRequired: true, browserOnline: true
  });
  assert.match(crossOrigin, /需要 OPTIONS 预检/);
  assert.match(crossOrigin, /不能仅凭此记录断定是 CORS/);
  assert.match(debugErrorZh(undefined, 'Failed to fetch', 0, { crossOrigin: false }), /同源请求/);
  assert.match(debugErrorZh(undefined, 'Failed to fetch', 0, { browserOnline: false }), /离线状态/);
  assert.match(debugErrorZh(undefined, 'Failed to fetch', 0, { timedOut: true }), /超时上限/);
  assert.match(debugErrorZh(undefined, 'Failed to fetch', 0, { aborted: true }), /调用方取消/);
});

it('does not invent a cause for unknown SDK errors', () => {
  assert.match(debugErrorZh('98765', 'unrecognized SDK error'), /没有可靠的中文原因说明/);
  assert.equal(debugErrorZh(undefined, undefined), null);
});
