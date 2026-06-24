# Gera o instalador Windows autônomo do Confere em C:\eb-out
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$HarnessRoot = Split-Path -Parent $ScriptDir
$OutDir = "C:\eb-out"

Set-Location $HarnessRoot

if (-not (Test-Path $OutDir)) {
  New-Item -ItemType Directory -Path $OutDir | Out-Null
}

Write-Host ">> Compilando Confere e gerando instalador NSIS em $OutDir ..."
npm run dist:eb

Copy-Item -Path (Join-Path $HarnessRoot "resources\LEIA-ME.txt") -Destination (Join-Path $OutDir "LEIA-ME.txt") -Force

Write-Host ""
Write-Host "Concluído. Artefatos em $OutDir :"
Get-ChildItem -Path $OutDir | Format-Table Name, Length, LastWriteTime
