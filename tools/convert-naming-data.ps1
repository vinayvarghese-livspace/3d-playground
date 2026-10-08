# Converts the naming convention workbook (sheet "Shot List") into data.js.
# Usage:  powershell -ExecutionPolicy Bypass -File tools\convert-naming-data.ps1 [-Source <xlsx>] [-Out <data.js>]
param(
  [string]$Source,
  [string]$Out = (Join-Path $PSScriptRoot '..\data.js')
)
$ErrorActionPreference = 'Stop'

if (-not $Source) {
  $Source = Get-ChildItem (Join-Path $PSScriptRoot '..\Data') -Recurse -Filter *.xlsx |
    Where-Object { $_.Name -notlike '~$*' } |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
  if (-not $Source) { throw 'No .xlsx found under Data\' }
}
$file = Get-Item -LiteralPath $Source
Write-Host "Source: $($file.FullName)"
Write-Host "Last modified: $($file.LastWriteTime)"

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($file.FullName)
function Read-Entry($name) {
  $e = $zip.GetEntry($name)
  if (-not $e) { return $null }
  $r = New-Object IO.StreamReader($e.Open(), [Text.Encoding]::UTF8)
  try { return $r.ReadToEnd() } finally { $r.Close() }
}
try {
  $ssXml = Read-Entry 'xl/sharedStrings.xml'
  $sheetXml = Read-Entry 'xl/worksheets/sheet1.xml'
} finally { $zip.Dispose() }
if (-not $sheetXml) { throw 'xl/worksheets/sheet1.xml not found' }

$strings = @()
if ($ssXml) {
  [xml]$ss = $ssXml
  $strings = @(foreach ($si in $ss.sst.si) {
    $tNodes = $si.SelectNodes("*[local-name()='t'] | *[local-name()='r']/*[local-name()='t']")
    (($tNodes | ForEach-Object { $_.InnerText }) -join '')
  })
}

[xml]$sheet = $sheetXml
$rows = @()
foreach ($row in $sheet.worksheet.sheetData.row) {
  $cells = @{}
  foreach ($c in $row.c) {
    $col = ($c.r -replace '\d', '')
    $v = $c.v
    if ($c.t -eq 's') { $v = $strings[[int]$v] }
    elseif ($c.t -eq 'inlineStr') { $v = $c.is.InnerText }
    if ($null -ne $v) { $cells[$col] = ("$v" -replace '\s+', ' ').Trim() }
  }
  $rows += [pscustomobject]@{ Row = [int]$row.r; Cells = $cells }
}

$header = $rows[0].Cells
$expected = @{ A = 'Category'; B = 'Product Type'; C = 'Variant'; D = 'Seq'; E = 'Image Name'; F = 'Shot Code' }
foreach ($k in $expected.Keys) {
  if ($header[$k] -ne $expected[$k]) { throw "Unexpected header in column ${k}: '$($header[$k])' (expected '$($expected[$k])')" }
}

$warnings = New-Object System.Collections.Generic.List[string]
$types = [ordered]@{}
$blankCategory = New-Object System.Collections.Generic.List[string]
$current = $null
$currentVariant = ''
$category = ''

foreach ($r in ($rows | Select-Object -Skip 1)) {
  $c = $r.Cells
  if (-not ($c.Values | Where-Object { $_ })) { continue }

  if ($c['B']) {
    if ($c['A']) { $category = $c['A'] }
    elseif ($category) { $blankCategory.Add("$($c['B']) (row $($r.Row))") }
    else { $warnings.Add("Row $($r.Row): product type '$($c['B'])' has no category") }
    $typeName = $c['B']
    $variant = if ($c['C']) { $c['C'] } else { '' }
    $currentVariant = $variant
    $key = "$category`t$typeName"
    if (-not $types.Contains($key)) {
      $types[$key] = [ordered]@{ name = $typeName; category = $category; blocks = [ordered]@{} }
    }
    $t = $types[$key]
    if ($t.blocks.Contains($variant)) {
      $label = if ($variant) { "$variant (row $($r.Row))" } else { "Standard (row $($r.Row))" }
      $warnings.Add("Row $($r.Row): '$typeName' / '$(if ($variant) { $variant } else { '(no variant)' })' already exists in $category - added as variant '$label'")
      $variant = $label
    }
    $t.blocks[$variant] = New-Object System.Collections.Generic.List[object]
    $current = $t.blocks[$variant]
  } elseif ($c['A']) {
    $warnings.Add("Row $($r.Row): category set without a product type - ignored")
  } elseif ($c['C'] -and $c['C'] -ne $currentVariant) {
    $warnings.Add("Row $($r.Row): variant '$($c['C'])' differs from its block variant '$currentVariant' - ignored")
  }

  if ($null -eq $current) { $warnings.Add("Row $($r.Row): shot before any product type - skipped"); continue }

  foreach ($k in 'G','H','I','J') { if ($c[$k]) { $warnings.Add("Row $($r.Row): extra value in column ${k}: '$($c[$k])'") } }

  $seq = $c['D']; $name = $c['E']; $code = $c['F']
  if (-not $name -or -not $code -or -not $seq) {
    $warnings.Add("Row $($r.Row): missing Seq/Image Name/Shot Code - skipped"); continue
  }
  if ($seq -match '^\d+$') { $seq = $seq.PadLeft(2, '0') } else { $warnings.Add("Row $($r.Row): Seq '$seq' is not a number") }
  if ($code -cmatch '[^A-Z0-9\-]') { $warnings.Add("Row $($r.Row): shot code '$code' has characters other than A-Z, 0-9, '-'") }

  $note = ''
  if ($name -match '^(.*?)\s*\((Marketplace MAIN)\)\s*$') { $name = $matches[1]; $note = $matches[2] }

  if ($current | Where-Object { $_.seq -eq $seq }) { $warnings.Add("Row $($r.Row): duplicate seq $seq in this block") }
  $current.Add([ordered]@{ seq = $seq; name = $name; code = $code; note = $note })
}

function JsStr($s) {
  $s = "$s" -replace '\\', '\\' -replace '"', '\"'
  return '"' + $s + '"'
}
function ShotsJs($shots, $indent) {
  $items = foreach ($s in $shots) {
    $parts = @("seq: $(JsStr $s.seq)", "name: $(JsStr $s.name)", "code: $(JsStr $s.code)")
    if ($s.note) { $parts += "note: $(JsStr $s.note)" }
    "$indent  { " + ($parts -join ', ') + ' }'
  }
  return "[`n" + ($items -join ",`n") + "`n$indent]"
}

$typeJs = foreach ($t in $types.Values) {
  $keys = @($t.blocks.Keys)
  $named = @($keys | Where-Object { $_ })
  if ($named.Count -and $keys -contains '') {
    $warnings.Add("Product type '$($t.name)' has both variant and non-variant blocks - non-variant block listed as 'Standard'")
  }
  $head = "    {`n      name: $(JsStr $t.name),`n      category: $(JsStr $t.category),`n"
  if ($named.Count) {
    $vs = foreach ($k in $keys) {
      $label = if ($k) { $k } else { 'Standard' }
      "        $(JsStr $label): $(ShotsJs $t.blocks[$k] '        ')"
    }
    $head + "      variants: {`n" + ($vs -join ",`n") + "`n      }`n    }"
  } else {
    $head + "      shots: $(ShotsJs $t.blocks[''] '      ')`n    }"
  }
}

$updated = $file.LastWriteTime.ToString('yyyy-MM-ddTHH:mm:ss')
$js = @"
// Generated by tools/convert-naming-data.ps1 - do not edit by hand.
// Source: $($file.Name)
window.NAMING_DATA = {
  source: $(JsStr $file.Name),
  updatedAt: $(JsStr $updated),
  minSize: 3000,
  outputSize: 3000,
  productTypes: [
$($typeJs -join ",`n")
  ]
};
"@

$outPath = [IO.Path]::GetFullPath($Out)
[IO.File]::WriteAllText($outPath, $js, (New-Object Text.UTF8Encoding($false)))

$shotCount = ($types.Values | ForEach-Object { $_.blocks.Values | ForEach-Object { $_.Count } } | Measure-Object -Sum).Sum
Write-Host "Product types: $($types.Count)  Shots: $shotCount"
Write-Host "Wrote: $outPath"
if ($blankCategory.Count) {
  Write-Host "`nBlank category, inherited from the block above ($($blankCategory.Count)):" -ForegroundColor Cyan
  Write-Host ('  ' + ($blankCategory -join ', ')) -ForegroundColor Cyan
}
if ($warnings.Count) {
  Write-Host "`nWarnings ($($warnings.Count)):" -ForegroundColor Yellow
  $warnings | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
} else {
  Write-Host 'No warnings.'
}

Write-Host "`nRemember to bump data.js?v= in index.html." -ForegroundColor Cyan
