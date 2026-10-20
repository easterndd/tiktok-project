param(
  [string]$CsvPath = 'tmp/newbeat-mini-apps.csv',
  [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$csvFile = Join-Path $repoRoot $CsvPath
$apiEnvFile = Join-Path $repoRoot 'apps/api/.env'
$apps = [ordered]@{
  LucidReel = 'lucidreel'
  AstraClip = 'astraclip'
  LumoReel = 'lumoreel'
  OrbitPlay = 'orbitplay'
  ZenClip = 'zenclip'
  AuraClip = 'auraclip'
  FluxPlay = 'fluxplay'
  DriftReel = 'driftreel'
  NovaClip = 'novaclip'
  LumiShort = 'lumishort'
}
$fields = @('appName', 'appId', 'clientKey', 'clientSecret', 'rewardedPlacementId', 'entryPlacementId')

function Read-EnvLines([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { throw "Missing environment file: $path" }
  return @(Get-Content -LiteralPath $path)
}

function Get-EnvValue([string[]]$lines, [string]$key) {
  $matches = @($lines | Where-Object { $_ -match ('^' + [regex]::Escape($key) + '=') })
  if ($matches.Count -ne 1) { throw "Expected one $key entry in apps/api/.env" }
  return ($matches[0] -split '=', 2)[1].Trim('"', "'")
}

function Set-EnvValue([string[]]$lines, [string]$key, [string]$value) {
  $matches = @($lines | Where-Object { $_ -match ('^' + [regex]::Escape($key) + '=') })
  if ($matches.Count -gt 1) { throw "Duplicate environment key: $key" }
  if ($matches.Count -eq 0) { return @($lines) + "${key}=$value" }
  return @($lines | ForEach-Object {
    if ($_ -match ('^' + [regex]::Escape($key) + '=')) { "${key}=$value" } else { $_ }
  })
}

$rows = @(Import-Csv -LiteralPath $csvFile)
if ($rows.Count -ne $apps.Count) { throw "Expected $($apps.Count) CSV rows; found $($rows.Count)" }
if (@(Compare-Object -ReferenceObject $fields -DifferenceObject @($rows[0].PSObject.Properties.Name)).Count) {
  throw 'CSV headers do not match the expected six fields'
}
foreach ($field in $fields) {
  if (@($rows | Group-Object -Property $field | Where-Object Count -gt 1).Count) {
    throw "Duplicate CSV field: $field"
  }
}
foreach ($row in $rows) {
  if (-not $apps.Contains($row.appName)) { throw "Unexpected app name: $($row.appName)" }
  if ($row.appId -notmatch '^\d+$') { throw "Invalid decimal App ID for $($row.appName)" }
  foreach ($field in $fields[2..5]) {
    if ($row.$field -notmatch '^[A-Za-z0-9._-]+$') {
      throw "Missing or unsupported characters in $field for $($row.appName)"
    }
  }
}

$apiLines = Read-EnvLines $apiEnvFile
$baseDatabaseUrl = Get-EnvValue $apiLines 'DATABASE_URL'
$bootstrapPassword = Get-EnvValue $apiLines 'ADMIN_BOOTSTRAP_PASSWORD'
if ($bootstrapPassword.Length -lt 12) { throw 'ADMIN_BOOTSTRAP_PASSWORD must contain at least 12 characters' }
if ($baseDatabaseUrl -notmatch '^postgres(ql)?://') { throw 'DATABASE_URL must be a PostgreSQL URL' }
$baseUri = [uri]$baseDatabaseUrl
if (-not $baseUri.Host -or -not $baseUri.AbsolutePath.Trim('/')) { throw 'DATABASE_URL must include a host and database' }

$updates = @()
foreach ($row in $rows) {
  $key = $apps[$row.appName]
  $prefix = $key.ToUpperInvariant()
  $appRoot = Join-Path $repoRoot "apps/$key"
  $configFile = Join-Path $appRoot 'minis.config.json'
  $config = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
  if ($config.dev.name -cne $row.appName) { throw "Mini name mismatch for $key" }
  if ($config.appId -and $config.appId -ne $row.appId) { throw "Existing App ID differs for $key" }
  $config.appId = $row.appId

  $miniEnvFile = Join-Path $appRoot '.env'
  $miniLines = if (Test-Path -LiteralPath $miniEnvFile) { Read-EnvLines $miniEnvFile } else {
    Read-EnvLines (Join-Path $appRoot '.env.example')
  }
  $miniLines = Set-EnvValue $miniLines 'VITE_API_BASE_URL' "https://api.evergreenprosper.com/api/$key/v1"
  $miniLines = Set-EnvValue $miniLines 'VITE_TIKTOK_CLIENT_KEY' $row.clientKey

  $schemaUrl = $baseDatabaseUrl
  if ($schemaUrl -match '([?&])schema=') {
    $schemaUrl = $schemaUrl -replace '([?&])schema=[^&]*', "`${1}schema=$key"
  } else {
    $separator = if ($schemaUrl.Contains('?')) { '&' } else { '?' }
    $schemaUrl += "${separator}schema=$key"
  }
  if ($schemaUrl -notmatch '([?&])connection_limit=') { $schemaUrl += '&connection_limit=1' }

  $apiLines = Set-EnvValue $apiLines "${prefix}_DATABASE_URL" $schemaUrl
  $apiLines = Set-EnvValue $apiLines "${prefix}_TIKTOK_CLIENT_KEY" $row.clientKey
  $apiLines = Set-EnvValue $apiLines "${prefix}_TIKTOK_CLIENT_SECRET" $row.clientSecret
  $apiLines = Set-EnvValue $apiLines "${prefix}_TIKTOK_APP_ID" $row.appId
  $apiLines = Set-EnvValue $apiLines "${prefix}_REWARDED_PLACEMENT_ID" $row.rewardedPlacementId
  $apiLines = Set-EnvValue $apiLines "${prefix}_APP_ENTRY_PLACEMENT_ID" $row.entryPlacementId
  $updates += [pscustomobject]@{ Key = $key; ConfigFile = $configFile; Config = $config; MiniEnvFile = $miniEnvFile; MiniLines = $miniLines }
}
$apiLines = Set-EnvValue $apiLines 'ADMIN_BOOTSTRAP_EMAIL' 'caijiarong2@xuyins.com'

if ($ValidateOnly) {
  Write-Output "Validated $($updates.Count) apps; no files changed."
  return
}

foreach ($update in $updates) {
  $json = $update.Config | ConvertTo-Json -Depth 20
  Set-Content -LiteralPath $update.ConfigFile -Value $json -Encoding utf8NoBOM
  Set-Content -LiteralPath $update.MiniEnvFile -Value $update.MiniLines -Encoding utf8NoBOM
}
Set-Content -LiteralPath $apiEnvFile -Value $apiLines -Encoding utf8NoBOM
Write-Output "Imported $($updates.Count) apps. Client Secrets and the unchanged bootstrap password remain in ignored server configuration."
