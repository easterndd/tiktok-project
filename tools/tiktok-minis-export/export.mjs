import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const API_BASE = 'https://business-api.tiktok.com/open_api/v1.3/';
const HEADERS = ['广告账户 ID', '广告账户名称', '币种', 'Mini ID', 'Mini 名称', '日期', '消耗', '展示', '点击', '转化'];
const METRICS = ['minis_name', 'spend', 'impressions', 'clicks', 'conversion'];

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key?.startsWith('--') || !argv[i + 1]) throw new Error(`参数格式错误: ${key ?? ''}`);
    args[key.slice(2)] = argv[i + 1];
  }
  const ids = (args['advertiser-ids'] ?? '').split(',').map((id) => id.trim()).filter(Boolean);
  if (!ids.length || ids.some((id) => !/^\d+$/.test(id))) throw new Error('请用 --advertiser-ids 传入逗号分隔的数字账户 ID');
  const start = parseDate(args['start-date']);
  const end = parseDate(args['end-date']);
  const days = Math.round((end - start) / 86400000) + 1;
  if (days < 1 || days > 30) throw new Error('日期范围必须为 1 至 30 天，且结束日期不能早于开始日期');
  const output = path.resolve(args.output ?? `tiktok-minis-${args['start-date']}-${args['end-date']}.xlsx`);
  if (path.extname(output).toLowerCase() !== '.xlsx') throw new Error('输出路径必须以 .xlsx 结尾');
  return { ids: [...new Set(ids)], startDate: args['start-date'], endDate: args['end-date'], output };
}

function parseDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) throw new Error('日期必须使用 YYYY-MM-DD 格式');
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw new Error(`无效日期: ${value}`);
  return date;
}

export async function getJson(endpoint, params, token, fetchImpl = fetch, retry = 0) {
  const url = new URL(endpoint, API_BASE);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, Array.isArray(value) ? JSON.stringify(value) : String(value));
  let response;
  try {
    response = await fetchImpl(url, { headers: { 'Access-Token': token }, signal: AbortSignal.timeout(30000) });
  } catch (error) {
    throw new Error(`TikTok 网络请求失败: ${error.message}`);
  }
  if ((response.status === 429 || response.status >= 500) && retry < 3) {
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** retry));
    return getJson(endpoint, params, token, fetchImpl, retry + 1);
  }
  if (!response.ok) throw new Error(`TikTok HTTP ${response.status}: ${endpoint}`);
  const body = await response.json();
  if (Number(body.code) !== 0) throw new Error(`TikTok API ${body.code ?? 'unknown'}: ${body.message ?? '请求失败'} (request_id: ${body.request_id ?? 'unknown'})`);
  return body.data ?? {};
}

export async function getAccount(id, token, fetchImpl = fetch) {
  const data = await getJson('advertiser/info/', { advertiser_ids: [id] }, token, fetchImpl);
  const account = (data.list ?? []).find((item) => String(item.advertiser_id) === id);
  const name = account?.name ?? account?.advertiser_name;
  if (!name) throw new Error(`账户 ${id} 未返回名称，请核对授权和 /advertiser/info/ 返回字段`);
  return { id, name, currency: account.currency ?? account.currency_code ?? '' };
}

export async function getReport(account, startDate, endDate, token, fetchImpl = fetch) {
  const rows = [];
  let page = 1;
  while (true) {
    const data = await getJson('report/integrated/get/', {
      advertiser_id: account.id,
      service_type: 'AUCTION',
      report_type: 'BASIC',
      data_level: 'AUCTION_ADVERTISER',
      dimensions: ['minis_id', 'advertiser_id', 'stat_time_day'],
      metrics: METRICS,
      start_date: startDate,
      end_date: endDate,
      page,
      page_size: 1000
    }, token, fetchImpl);
    const list = data.list;
    if (!Array.isArray(list)) throw new Error(`账户 ${account.id} 第 ${page} 页缺少 data.list`);
    for (const item of list) {
      const dimension = item.dimensions ?? {};
      const metric = item.metrics ?? {};
      const miniId = dimension.minis_id;
      const miniName = metric.minis_name;
      const day = String(dimension.stat_time_day ?? '').slice(0, 10);
      if (miniId === undefined || miniName === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
        throw new Error(`账户 ${account.id} 第 ${page} 页缺少 minis_id、minis_name 或 stat_time_day，已停止导出`);
      }
      if (dimension.advertiser_id !== undefined && String(dimension.advertiser_id) !== account.id) {
        throw new Error(`报表中的 advertiser_id 与请求账户 ${account.id} 不一致`);
      }
      rows.push([
        account.id, account.name, account.currency, String(miniId), String(miniName),
        parseDate(day), number(metric.spend, 'spend'), number(metric.impressions, 'impressions'),
        number(metric.clicks, 'clicks'), number(metric.conversion, 'conversion')
      ]);
    }
    const totalPages = Number(data.page_info?.total_page);
    if (Number.isFinite(totalPages) && totalPages > 0) {
      if (page >= totalPages) break;
    } else if (list.length < 1000) {
      break;
    }
    if (page >= 10000) throw new Error('分页超过 10000 页，已停止导出');
    page++;
  }
  return rows;
}

function number(value, field) {
  if (value === undefined || value === null || value === '') throw new Error(`报表缺少指标 ${field}`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`报表指标 ${field} 不是数字`);
  return parsed;
}

export async function writeWorkbook(rows, output, startDate, endDate, emptyMessage = '所选账户和日期范围内没有报表数据') {
  if (rows.length > 1048572) throw new Error('报表超过 Excel 单表行数上限，请缩小日期范围或拆分账户');
  const workbook = Workbook.create();
  const sheet = workbook.worksheets.add('Mini 报表');
  sheet.showGridLines = false;
  sheet.getRange('A1').values = [['TikTok Mini 广告日报']];
  sheet.getRange('A2').values = [[`日期：${startDate} 至 ${endDate} | 导出时间：${new Date().toISOString()}`]];
  sheet.getRange('A4:J4').values = [HEADERS];
  sheet.getRange('A1:J4').format.font = { name: 'Arial', size: 10, color: '#202A33' };
  sheet.getRange('A1').format.font = { name: 'Arial', size: 15, bold: true, color: '#202A33' };
  sheet.getRange('A4:J4').format = { fill: '#17324D', font: { name: 'Arial', size: 10, bold: true, color: '#FFFFFF' }, rowHeight: 25 };
  sheet.getRange('A:A').format.columnWidth = 21;
  sheet.getRange('B:B').format.columnWidth = 25;
  sheet.getRange('C:C').format.columnWidth = 11;
  sheet.getRange('D:D').format.columnWidth = 22;
  sheet.getRange('E:E').format.columnWidth = 34;
  sheet.getRange('F:F').format.columnWidth = 16;
  sheet.getRange('G:J').format.columnWidth = 15;
  if (rows.length) {
    const endRow = rows.length + 4;
    sheet.getRange(`A5:J${endRow}`).values = rows;
    sheet.getRange(`A5:J${endRow}`).format.font = { name: 'Arial', size: 10, color: '#202A33' };
    sheet.getRange(`F5:F${endRow}`).setNumberFormat('yyyy-mm-dd');
    sheet.getRange(`G5:G${endRow}`).setNumberFormat('#,##0.00');
    sheet.getRange(`H5:J${endRow}`).setNumberFormat('#,##0');
    sheet.tables.add(`A4:J${endRow}`, true, 'MiniReport');
    sheet.getRange(`A5:A${endRow}`).setNumberFormat('@');
    sheet.getRange(`D5:D${endRow}`).setNumberFormat('@');
  } else {
    sheet.getRange('A5').values = [[emptyMessage]];
  }
  sheet.freezePanes.freezeRows(4);
  workbook.recalculate();
  await fs.mkdir(path.dirname(output), { recursive: true });
  const file = await SpreadsheetFile.exportXlsx(workbook);
  await file.save(output);
}

export async function run(argv = process.argv.slice(2), env = process.env, fetchImpl = fetch) {
  const args = parseArgs(argv);
  const token = env.TIKTOK_BUSINESS_ACCESS_TOKEN;
  if (!token) throw new Error('缺少 TIKTOK_BUSINESS_ACCESS_TOKEN 环境变量');
  const rows = [];
  for (const id of args.ids) {
    const account = await getAccount(id, token, fetchImpl);
    rows.push(...await getReport(account, args.startDate, args.endDate, token, fetchImpl));
  }
  rows.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[3]).localeCompare(String(b[3])) || a[5] - b[5]);
  await writeWorkbook(rows, args.output, args.startDate, args.endDate);
  return { output: args.output, rows: rows.length, accounts: args.ids.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().then((result) => console.log(`已导出 ${result.accounts} 个账户、${result.rows} 行：${result.output}`))
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
}
