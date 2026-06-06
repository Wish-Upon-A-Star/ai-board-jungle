$ErrorActionPreference = "Stop"

Set-Location (Split-Path -Parent $PSScriptRoot)

function Stop-Port($Port) {
  $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if ($conn) {
    Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
  }
}

function Run-Step($Name, $ScriptBlock) {
  Write-Host "== $Name =="
  & $ScriptBlock
  if ($LASTEXITCODE -ne 0) {
    throw "$Name failed"
  }
}

Stop-Port 3000
Stop-Port 8788

$env:AI_BOARD_DEMO_MODE = "1"
$env:AI_BOARD_DEMO_DB_PATH = "data/demo-db.json"
$env:MCP_SERVER_URL = "http://127.0.0.1:8788/rpc"
$env:JWT_SECRET = "local-auto-verify-secret-change-me"

Run-Step "prisma generate" { npm run prisma:generate }
Run-Step "unit tests" { npm test }
Run-Step "lint" { npm run lint }
Run-Step "build" { npm run build }
Run-Step "seed demo db" { npm run demo:seed }

$mcpScript = "Set-Location '$PWD'; `$env:MCP_PORT='8788'; npm run mcp:server *> mcp.log"
$mcp = Start-Process -FilePath powershell -ArgumentList @("-NoProfile", "-Command", $mcpScript) -WindowStyle Hidden -PassThru
try {
  Start-Sleep -Seconds 4
  $devScript = "Set-Location '$PWD'; `$env:AI_BOARD_DEMO_MODE='1'; `$env:AI_BOARD_DEMO_DB_PATH='data/demo-db.json'; `$env:MCP_SERVER_URL='http://127.0.0.1:8788/rpc'; `$env:JWT_SECRET='local-auto-verify-secret-change-me'; npm run dev -- --hostname 127.0.0.1 --port 3000 *> dev.log"
  $dev = Start-Process -FilePath powershell -ArgumentList @("-NoProfile", "-Command", $devScript) -WindowStyle Hidden -PassThru
  try {
    Start-Sleep -Seconds 8
    Run-Step "http smoke" { npm run smoke:http }
    Write-Host "AUTO_VERIFY_OK http://127.0.0.1:3000"
  } finally {
    Stop-Process -Id $dev.Id -Force -ErrorAction SilentlyContinue
    Stop-Port 3000
  }
} finally {
  Stop-Process -Id $mcp.Id -Force -ErrorAction SilentlyContinue
  Stop-Port 8788
}
