$ErrorActionPreference = 'Stop'
$version = (Get-Content 'src-tauri/tauri.conf.json' -Raw | ConvertFrom-Json).version
$installer = Join-Path $PWD "release-artifacts/windows/MarkdownShelf_${version}_windows_x64_setup.exe"
$installRoot = Join-Path $env:RUNNER_TEMP 'MarkdownShelfInstalledQA'
$installed = Start-Process -FilePath $installer -ArgumentList "/S /D=$installRoot" -Wait -PassThru
if ($installed.ExitCode -ne 0) { throw "Installer failed: $($installed.ExitCode)" }
$app = Join-Path $installRoot 'markdown-shelf.exe'
if (-not (Test-Path $app)) { throw "Application missing at $app" }
$license = Get-ChildItem $installRoot -Recurse -File -Filter LICENSE | Where-Object { $_.FullName -match '[\\/]legal[\\/]LICENSE$' }
if (-not $license) { throw 'Installed license resource missing' }
$notice = Get-ChildItem $installRoot -Recurse -File -Filter NOTICE
if (-not $notice) { throw 'Installed upstream notice missing' }
$dependencies = Get-ChildItem $installRoot -Recurse -File -Filter THIRD_PARTY_NOTICES.md
if (-not $dependencies) { throw 'Dependency license notices missing' }
$builtBytes = [System.IO.File]::ReadAllBytes((Join-Path $PWD 'src-tauri/target/release/markdown-shelf.exe'))
# Tauri patches exactly this bundle-type token before NSIS packaging, then
# restores the original build file. Compare every byte against that expected
# NSIS variant, rather than accepting arbitrary installer changes.
# https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-bundler/src/bundle.rs
$token = [Text.Encoding]::ASCII.GetBytes('__TAURI_BUNDLE_TYPE_VAR_UNK')
$replacement = [Text.Encoding]::ASCII.GetBytes('__TAURI_BUNDLE_TYPE_VAR_NSS')
$tokenOffset = [Text.Encoding]::ASCII.GetString($builtBytes).IndexOf('__TAURI_BUNDLE_TYPE_VAR_UNK',[StringComparison]::Ordinal)
if ($tokenOffset -lt 0) { throw 'Expected Tauri bundle-type token missing' }
[Array]::Copy($replacement,0,$builtBytes,$tokenOffset,$token.Length)
$sha = [Security.Cryptography.SHA256]::Create()
try { $expectedHash = [BitConverter]::ToString($sha.ComputeHash($builtBytes)).Replace('-','') } finally { $sha.Dispose() }
if ((Get-FileHash $app).Hash -ne $expectedHash) { throw 'Installed executable differs from expected NSIS build variant' }
$bytes = [System.IO.File]::ReadAllBytes($app)
$peOffset = [BitConverter]::ToInt32($bytes,0x3c)
if ([BitConverter]::ToUInt16($bytes,$peOffset+4) -ne 0x8664) { throw 'Expected Windows x64 executable' }
# Ask WebView2 to expose its accessibility tree for this isolated smoke test.
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--force-renderer-accessibility'
$qa = Join-Path $env:RUNNER_TEMP 'MarkdownShelfNativeQA'
New-Item -ItemType Directory -Force $qa | Out-Null
$doc = Join-Path $qa 'Native-QA.md'
[IO.File]::WriteAllText($doc,"# Windows installer QA`n`nIsolated native document.",[Text.UTF8Encoding]::new($false))
$process = Start-Process -FilePath $app -ArgumentList @($doc) -PassThru
try {
    $deadline = (Get-Date).AddSeconds(60)
    do {
        Start-Sleep -Milliseconds 500
        $process.Refresh()
        if ($process.HasExited) { throw "App exited before showing a window: $($process.ExitCode)" }
    } while ($process.MainWindowHandle -eq 0 -and (Get-Date) -lt $deadline)
    if ($process.MainWindowHandle -eq 0) { throw 'No application window appeared' }
    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $window = [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
    $names = @()
    do {
        $elements = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
        $names = @($elements | ForEach-Object { $_.Current.Name } | Where-Object { $_ })
        $rendered = ($names -join "`n")
        if ($rendered.Contains('Windows installer QA') -and $rendered.Contains('设为项目必读')) { break }
        Start-Sleep -Seconds 1
    } while ((Get-Date) -lt $deadline)
    if (-not ($rendered.Contains('Windows installer QA') -and $rendered.Contains('设为项目必读'))) { throw 'Frontend content not found in native accessibility tree' }
    function Read-Names {
        $script:elements = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
        return @($script:elements | ForEach-Object { $_.Current.Name } | Where-Object { $_ })
    }
    function Click-Button($name) {
        $button = @($script:elements | Where-Object { $_.Current.Name -eq $name -and $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button }) | Select-Object -First 1
        if (-not $button) { throw "Native button missing: $name" }
        $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
    }
    $names = Read-Names
    Click-Button '设为项目必读'
    $deadline = (Get-Date).AddSeconds(30)
    do { Start-Sleep -Milliseconds 300; $names = Read-Names } while (-not ($names -contains '移出必读') -and (Get-Date) -lt $deadline)
    if (-not ($names -contains '移出必读')) { throw 'Native required-reading mark did not persist' }
    [IO.File]::WriteAllText($doc,"# Updated Windows QA`n`nChanged externally.",[Text.UTF8Encoding]::new($false))
    $deadline = (Get-Date).AddSeconds(30)
    do { Start-Sleep -Milliseconds 500; $names = Read-Names } while (-not (($names -join "`n").Contains('Updated Windows QA') -and $names -contains '确认更新') -and (Get-Date) -lt $deadline)
    if (-not ($names -contains '确认更新')) { throw 'External modification was not marked for review' }
    Click-Button '确认更新'
    $deadline = (Get-Date).AddSeconds(20)
    do { Start-Sleep -Milliseconds 300; $names = Read-Names } while (($names -contains '确认更新') -and (Get-Date) -lt $deadline)
    if ($names -contains '确认更新') { throw 'Explicit native reconfirmation failed' }
    Add-Type -AssemblyName System.Drawing
    $rect = $window.Current.BoundingRectangle
    $bitmap = New-Object System.Drawing.Bitmap ([int]$rect.Width),([int]$rect.Height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.CopyFromScreen([int]$rect.X,[int]$rect.Y,0,0,$bitmap.Size)
        $bitmap.Save((Join-Path $env:RUNNER_TEMP 'shelf-windows-native.png'))
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
    @{
        ok = $true
        os = [Environment]::OSVersion.VersionString
        architecture = 'x64'
        installerExitCode = $installed.ExitCode
        installedBinaryMatchesBuild = $true
        comparison = 'Exact SHA-256 match after the single documented UNK-to-NSS Tauri bundle token patch.'
        installedBinarySha256 = $expectedHash.ToLowerInvariant()
        licenseResourcesPresent = $true
        windowTitle = $process.MainWindowTitle
        renderedControls = $names
        scope = 'Windows Server 2022 hosted runner: silent installation, exact installed binary, native file-target launch, rendered Markdown, required-reading selection, actual external disk modification and explicit reconfirmation. Physical Windows 10/11 not manually tested.'
    } | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $env:RUNNER_TEMP 'shelf-windows-native.json') -Encoding utf8
} finally {
    if (-not $process.HasExited) {
        $null = $process.CloseMainWindow()
        if (-not $process.WaitForExit(10000)) { $process.Kill() }
    }
}
