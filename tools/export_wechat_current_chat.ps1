param(
  [switch]$Help,
  [switch]$NoAutoCopy,
  [switch]$SelectAll,
  [switch]$Import,
  [string]$SessionId = "",
  [string]$ApiUrl = "http://localhost:3000",
  [string]$OutputDir = "",
  [string]$UserAliases = "me,user,self",
  [string]$AssistantAliases = "assistant,ai,bot",
  [int]$WaitSeconds = 2
)

$ErrorActionPreference = "Stop"

function Show-Help {
  @"
Export the currently opened WeChat chat text through the clipboard.

This tool does not read or decrypt WeChat databases. It only copies text from
the current WeChat window or saves text that is already in the clipboard.

Typical usage:
  1. Open WeChat and click the chat you want to export.
  2. Scroll upward until the history range you need is loaded.
  3. Run:
       powershell -ExecutionPolicy Bypass -File tools\export_wechat_current_chat.ps1 -SelectAll

Safer manual-copy mode:
  1. In WeChat, select the messages you want, then press Ctrl+C.
  2. Run:
       powershell -ExecutionPolicy Bypass -File tools\export_wechat_current_chat.ps1 -NoAutoCopy

Import into this project after export:
       powershell -ExecutionPolicy Bypass -File tools\export_wechat_current_chat.ps1 -SelectAll -Import -SessionId <UUID>

Options:
  -SelectAll        Send Ctrl+A before Ctrl+C. Useful when the chat area supports select all.
  -NoAutoCopy       Do not activate WeChat or press keys; save current clipboard text only.
  -Import           POST exported text to /api/import/chat-records.
  -SessionId        Target session UUID for import.
  -ApiUrl           Backend base URL. Default: http://localhost:3000
  -OutputDir        Export directory. Default: <project>\exports\wechat
  -UserAliases      Comma-separated aliases for the user.
  -AssistantAliases Comma-separated aliases for the assistant.
"@
}

if ($Help) {
  Show-Help
  exit 0
}

if (-not $OutputDir) {
  $projectRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
  $OutputDir = Join-Path $projectRoot "exports\wechat"
}
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

function Get-ClipboardText {
  try {
    return Get-Clipboard -Raw -Format Text
  } catch {
    return Get-Clipboard -Raw
  }
}

function Activate-WeChat {
  $candidates = @("WeChat", "Weixin", "WeChatAppEx", "WeChatPlayer", "微信")
  $shell = New-Object -ComObject WScript.Shell

  foreach ($name in $candidates) {
    $processes = Get-Process -Name $name -ErrorAction SilentlyContinue |
      Where-Object { $_.MainWindowHandle -ne 0 }

    foreach ($process in $processes) {
      if ($shell.AppActivate($process.Id)) { return $true }
      if ($process.MainWindowTitle -and $shell.AppActivate($process.MainWindowTitle)) { return $true }
    }
  }

  foreach ($process in Get-Process -ErrorAction SilentlyContinue) {
    if ($process.MainWindowHandle -ne 0 -and $process.MainWindowTitle -match "微信|WeChat") {
      if ($shell.AppActivate($process.Id)) { return $true }
      if ($shell.AppActivate($process.MainWindowTitle)) { return $true }
    }
  }

  return $false
}

function Invoke-Import([string]$Text, [string]$Path) {
  if (-not $SessionId) {
    throw "-Import requires -SessionId <UUID>."
  }

  $payload = @{
    sessionId = $SessionId
    text = $Text
    userAliases = ($UserAliases -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    assistantAliases = ($AssistantAliases -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    unknownSpeakerRole = "user"
    triggerMemoryExtraction = $true
    generateSummary = $true
    extractProfile = $true
  }

  $json = $payload | ConvertTo-Json -Depth 8
  $uri = ($ApiUrl.TrimEnd("/")) + "/api/import/chat-records"
  $result = Invoke-RestMethod -Method Post -Uri $uri -ContentType "application/json; charset=utf-8" -Body $json

  Write-Host ""
  Write-Host "Imported into AI Companion:"
  Write-Host "  File: $Path"
  Write-Host "  Parsed: $($result.parsed)"
  Write-Host "  Inserted: $($result.inserted)"
  Write-Host "  Memory queued: $($result.memoryExtractionQueued)"
  Write-Host "  Summary queued: $($result.summaryQueued)"
  Write-Host "  Profile queued: $($result.profileExtractionQueued)"
}

$before = Get-ClipboardText

if (-not $NoAutoCopy) {
  if (-not (Activate-WeChat)) {
    throw "Could not activate WeChat. Open WeChat, click the target chat, then retry or use -NoAutoCopy after manually copying."
  }

  Start-Sleep -Milliseconds 500

  Add-Type -AssemblyName System.Windows.Forms
  if ($SelectAll) {
    [System.Windows.Forms.SendKeys]::SendWait("^a")
    Start-Sleep -Milliseconds 500
  }
  [System.Windows.Forms.SendKeys]::SendWait("^c")
  Start-Sleep -Seconds $WaitSeconds
}

$text = Get-ClipboardText

if (-not $text -or -not $text.Trim()) {
  if ($before -and $before.Trim()) {
    $text = $before
  } else {
    throw "Clipboard is empty. Select/copy messages in WeChat first, or run with -SelectAll."
  }
}

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$outFile = Join-Path $OutputDir "wechat_current_chat_$stamp.txt"

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($outFile, $text, $utf8NoBom)

$lineCount = ($text -split "\r?\n").Count
$charCount = $text.Length

Write-Host "Exported WeChat clipboard text:"
Write-Host "  File: $outFile"
Write-Host "  Lines: $lineCount"
Write-Host "  Characters: $charCount"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  Preview:"
Write-Host ("    Get-Content -LiteralPath " + '"' + $outFile + '"' + " -TotalCount 40")
Write-Host "  Convert/preview with project parser:"
Write-Host ("    python tools\chat_converter.py " + '"' + $outFile + '"' + " --preview")
Write-Host "  Import manually:"
Write-Host ("    python tools\chat_converter.py " + '"' + $outFile + '"' + " --api-url " + $ApiUrl + " --session-id <UUID>")

if ($Import) {
  Invoke-Import -Text $text -Path $outFile
}
