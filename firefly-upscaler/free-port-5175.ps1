# Stop whatever is listening on 5175 so a fresh install can bind.
$ErrorActionPreference = 'SilentlyContinue'
$conns = Get-NetTCPConnection -LocalPort 5175 -State Listen
foreach ($c in $conns) {
  if ($c.OwningProcess) {
    Stop-Process -Id $c.OwningProcess -Force
  }
}
Start-Sleep -Seconds 1
exit 0
