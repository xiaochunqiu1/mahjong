// 查询 CloudBase 云函数日志（CLS）
// 运行：npx tsx tests/get-fn-log.ts
import CloudBase from '@cloudbase/node-sdk';

const app = CloudBase.init({ env: 'qzmj-d8ge0bj5g9257711b' });
const svc = app.getLogService();
const now = Date.now();
const res = await svc.searchClsLog({
  query: 'function_name:room-api',
  limit: 20,
  startTime: Math.floor((now - 3600_000) / 1000), // 最近 1 小时
  endTime: Math.floor(now / 1000),
});
console.log(JSON.stringify(res, null, 2).slice(0, 4000));
