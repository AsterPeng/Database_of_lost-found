# P7 备份与恢复验证
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts/db/backup-restore.ps1
#
# 默认从项目根目录 .env 读取 DATABASE_URL（clfp_enhanced），
# 备份到 D:\ClaudeCodeProjects\clfp-backups，恢复并校验 clfp_restore_check。
# 不会连接或修改 clfp_original。

param(
  [string]$EnvFile = (Join-Path $PSScriptRoot "..\..\.env"),
  [string]$BackupDir = "D:\ClaudeCodeProjects\clfp-backups",
  [string]$TempDatabase = "clfp_restore_check"
)

$ErrorActionPreference = "Stop"

$pgBin = "D:\Program Files\PostgreSQL\18\bin"
$psql = Join-Path $pgBin "psql.exe"
$pgDump = Join-Path $pgBin "pg_dump.exe"
$pgRestore = Join-Path $pgBin "pg_restore.exe"

foreach ($tool in @($psql, $pgDump, $pgRestore)) {
  if (-not (Test-Path -LiteralPath $tool)) {
    throw "找不到 PostgreSQL 工具：$tool"
  }
}

$line = Get-Content -LiteralPath $EnvFile |
  Where-Object { $_ -match '^\s*DATABASE_URL=' } |
  Select-Object -First 1
if (-not $line) {
  throw "在 $EnvFile 中找不到 DATABASE_URL"
}

$sourceUrl = ($line -replace '^\s*DATABASE_URL=', '').Trim().Trim('"')
$baseUrl = $sourceUrl -replace '\?.*$', ''
$adminUrl = $baseUrl -replace '/[^/]+$', '/postgres'
$tempUrl = $baseUrl -replace '/[^/]+$', "/$TempDatabase"

if ($baseUrl -match '/clfp_original(?:\?|$)') {
  throw "拒绝操作：clfp_original 是原项目冻结库，不允许作为 P7 备份源"
}

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$backupPath = Join-Path $BackupDir "clfp_enhanced_$timestamp.dump"
$displayUrl = $baseUrl -replace '://([^:]+):[^@]+@', '://$1:***@'

Write-Host "1. 备份源库到自定义格式文件"
Write-Host "   源库：$displayUrl"
Write-Host "   目标：$backupPath"
& $pgDump --format=custom --no-owner --no-privileges --file=$backupPath $baseUrl
if ($LASTEXITCODE -ne 0) {
  throw "pg_dump 失败，退出码 $LASTEXITCODE"
}
$backupSize = (Get-Item -LiteralPath $backupPath).Length
Write-Host ("   备份大小：{0:N0} 字节" -f $backupSize)

Write-Host "2. 重建临时恢复库 $TempDatabase"
& $psql $adminUrl -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $TempDatabase WITH (FORCE);"
if ($LASTEXITCODE -ne 0) { throw "删除临时库失败" }
& $psql $adminUrl -v ON_ERROR_STOP=1 -c "CREATE DATABASE $TempDatabase;"
if ($LASTEXITCODE -ne 0) { throw "创建临时库失败" }

Write-Host "3. pg_restore 恢复到临时库"
& $pgRestore --no-owner --no-privileges --exit-on-error --dbname=$tempUrl $backupPath
if ($LASTEXITCODE -ne 0) {
  throw "pg_restore 失败，退出码 $LASTEXITCODE（临时库 $TempDatabase 保留用于排查）"
}

$verifySql = @"
SELECT json_build_object(
  'users', (SELECT count(*) FROM users),
  'posts', (SELECT count(*) FROM posts),
  'post_images', (SELECT count(*) FROM post_images),
  'matches', (SELECT count(*) FROM matches),
  'claims', (SELECT count(*) FROM claims),
  'handovers', (SELECT count(*) FROM handovers),
  'contact_grants', (SELECT count(*) FROM contact_grants),
  'notifications', (SELECT count(*) FROM notifications),
  'audit_logs', (SELECT count(*) FROM audit_logs),
  'announcements', (SELECT count(*) FROM announcements),
  'categories', (SELECT count(*) FROM categories),
  'views', (SELECT count(*) FROM pg_views WHERE schemaname = 'public' AND viewname LIKE 'v_%'),
  'matviews', (SELECT count(*) FROM pg_matviews WHERE schemaname = 'public'),
  'triggers', (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal),
  'policies', (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'),
  'rls_tables', (
    SELECT count(*) FROM pg_class
    WHERE relname IN ('notifications', 'claims', 'contact_grants')
      AND relrowsecurity
  ),
  'users_checksum', (
    SELECT md5(COALESCE(string_agg(
      id || '|' || email || '|' || nickname || '|' || role::text || '|' || status::text,
      ',' ORDER BY id
    ), '')) FROM users
  ),
  'posts_checksum', (
    SELECT md5(COALESCE(string_agg(
      id || '|' || author_id || '|' || type::text || '|' || title || '|' || status::text || '|' || COALESCE(deleted_at::text, ''),
      ',' ORDER BY id
    ), '')) FROM posts
  ),
  'claims_checksum', (
    SELECT md5(COALESCE(string_agg(
      id || '|' || post_id || '|' || claimant_id || '|' || status::text,
      ',' ORDER BY id
    ), '')) FROM claims
  ),
  'matches_checksum', (
    SELECT md5(COALESCE(string_agg(
      id || '|' || lost_post_id || '|' || found_post_id || '|' || score::text,
      ',' ORDER BY id
    ), '')) FROM matches
  )
)::text;
"@

Write-Host "4. 对比源库与恢复库的行数、校验和与对象数量"
$sourceJson = & $psql $baseUrl -At -v ON_ERROR_STOP=1 -c $verifySql
if ($LASTEXITCODE -ne 0) { throw "读取源库校验信息失败" }
$restoreJson = & $psql $tempUrl -At -v ON_ERROR_STOP=1 -c $verifySql
if ($LASTEXITCODE -ne 0) { throw "读取恢复库校验信息失败" }

$source = $sourceJson | ConvertFrom-Json
$restored = $restoreJson | ConvertFrom-Json

$rows = @()
$failed = $false
foreach ($key in $source.PSObject.Properties.Name) {
  $sourceValue = $source.$key
  $restoredValue = $restored.$key
  $match = ($sourceValue -eq $restoredValue)
  if (-not $match) { $failed = $true }
  $rows += [pscustomobject]@{
    Metric   = $key
    Source   = $sourceValue
    Restored = $restoredValue
    Match    = $match
  }
}
$rows | Format-Table -AutoSize

if ($failed) {
  throw "恢复校验失败；临时库 $TempDatabase 保留用于排查"
}

Write-Host "5. 清理临时恢复库"
& $psql $adminUrl -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $TempDatabase WITH (FORCE);"
if ($LASTEXITCODE -ne 0) {
  throw "清理临时库失败；请手动删除 $TempDatabase"
}

Write-Host ""
Write-Host "P7 备份与恢复验证通过"
Write-Host "备份文件：$backupPath"
Write-Host "备份大小：$backupSize 字节"
Write-Host "注意：备份不包含 ENCRYPTION_KEY，也不包含 storage/uploads 图片文件。"
Write-Host "注意：角色是集群级对象；新集群恢复前需先执行 06_roles_rls.sql 创建角色。"