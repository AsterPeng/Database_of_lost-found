# SQL 脚本说明

本目录是课程设计与答辩用的**独立 SQL 脚本**，与 `prisma/migrations/` 中的迁移等价。迁移用于应用部署，本目录用于阅读、提交和演示。

| 文件 | 内容 | 执行顺序 |
| --- | --- | --- |
| `00_schema.sql` | P1 基线结构快照（`pg_dump --schema-only`） | 1 |
| `01_constraints_indexes.sql` | P2：外键、CHECK、唯一/部分唯一索引、trgm 索引 | 2 |
| `02_views.sql` | P2：6 个业务视图 | 3 |
| `03_functions.sql` | P2：认领审核、超时转交、交接完成、统计函数 | 4 |
| `04_triggers.sql` | P2：帖子状态机、匹配一致性、认领审计触发器 | 5 |
| `05_materialized_views.sql` | P2：院系/类别物化视图与刷新函数 | 6 |
| `06_roles_rls.sql` | P4：角色、授权与行级安全 | 7 |
| `07_benchmark_queries.sql` | P6：基准查询与执行计划 | 8 |
| `08_demo_queries.sql` | P8：答辩演示查询 | 9 |

## 使用方式

- **不要在正在运行的开发库上直接执行这些脚本**，它们假设表结构处于对应阶段，且没有做重复执行保护。
- 推荐在全新数据库上按顺序执行，或直接使用 Prisma 迁移：
  ```bash
  npx prisma migrate deploy
  ```
- 单独验证 P2 对象可使用：
  ```bash
  psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/db/smoke-p2.sql
  ```

## 与迁移的对应关系

| 迁移 | 本目录脚本 |
| --- | --- |
| `20261102090000_db_course_constraints_indexes` | `01_constraints_indexes.sql` |
| `20261102091000_db_course_views` | `02_views.sql` |
| `20261102092000_db_course_functions` | `03_functions.sql` |
| `20261102093000_db_course_triggers_mv` | `04_triggers.sql`、`05_materialized_views.sql` |
| `20261102093500_fix_claim_audit_decision` | 已合并进 `04_triggers.sql` |
| `20261102094000_relax_claim_handover_checks` | 已合并进 `01_constraints_indexes.sql` |
| `20261102094500_fix_mv_stats_category` | 已合并进 `05_materialized_views.sql` |