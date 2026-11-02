# 数据库实验脚本

本目录用于存放数据库课程化改造的造数、基准、并发、隔离级别、权限演示与备份恢复脚本。P2~P8 按阶段补充：

| 脚本 | 阶段 | 用途 |
| --- | --- | --- |
| `smoke-p2.sql` | P2 | 视图、函数、触发器、约束的 SQL 冒烟测试（事务内执行并回滚） |
| `verify-stats-parity.ts` | P3 | 对比 `computeStatsLegacy` 与 `fn_stats` 的 12 组统计口径 |
| `roles-demo.ts` | P4 | 角色、列级授权与 RLS 演示 |
| `concurrency-claim.ts` | P5 | 并发抢认领与行锁验证 |
| `isolation-levels.ts` | P5 | 隔离级别与异常现象实验 |
| `generate-data.ts` | P6 | 在 `clfp_bench` 生成 10 万级数据 |
| `benchmark.ts` | P6 | 基准查询与 `EXPLAIN (ANALYZE, BUFFERS)` 收集 |
| `backup-restore.ps1` | P7 | 备份、恢复与行数/校验和比对 |
| `generate-er-diagram.py` | P8 | 生成报告用 ER 图 |
| `export-report-docx.py` | P8 | 把课程报告 Markdown 导出为 Word |

> P3 的统计对比脚本必须在测试库运行，示例：
> ```bash
> DATABASE_URL="postgresql://.../clfp_test" npx tsx scripts/db/verify-stats-parity.ts
> ```
>
> P6 的造数与基准只允许在独立基准库 `clfp_bench` 运行：
> ```bash
> DATABASE_URL="postgresql://.../clfp_bench" npx tsx scripts/db/generate-data.ts
> DATABASE_URL="postgresql://.../clfp_bench" npx tsx scripts/db/benchmark.ts
> ```