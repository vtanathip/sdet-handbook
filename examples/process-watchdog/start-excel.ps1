# start-excel.ps1
# Launches Excel via COM automation and injects a VBA freeze-simulation macro.
# Run this once before run-watchdog.ps1.
#
# Usage:
#   .\start-excel.ps1              # launch Excel + inject VBA macro
#   .\start-excel.ps1 -NoMacro    # launch Excel only, skip VBA injection

param(
    [switch]$NoMacro   # skip VBA macro injection
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── 1. Attach to running Excel or create a new instance ──────────────────────
Write-Host "Looking for a running Excel instance..." -ForegroundColor Cyan

$comExcel     = $null
$weLaunchedIt = $false

try {
    $comExcel = [Runtime.InteropServices.Marshal]::GetActiveObject("Excel.Application")
    Write-Host "Attached to existing Excel instance." -ForegroundColor Green
} catch {
    Write-Host "None found — launching Excel via COM..." -ForegroundColor Cyan
    try {
        $comExcel = New-Object -ComObject Excel.Application
        $weLaunchedIt = $true
    } catch {
        Write-Error "Could not create Excel COM object. Is Microsoft Excel installed?`n$_"
        exit 1
    }
}

$comExcel.Visible = $true

# ── 2. Ensure a workbook is open ─────────────────────────────────────────────
if ($comExcel.Workbooks.Count -eq 0) {
    Write-Host "Adding blank workbook..." -ForegroundColor Cyan
    $comExcel.Workbooks.Add() | Out-Null
}

# ── 3. Resolve PID from the COM window handle ────────────────────────────────
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32Helper {
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
"@

$hwnd     = [IntPtr]$comExcel.Hwnd
$excelPid = 0u
[Win32Helper]::GetWindowThreadProcessId($hwnd, [ref]$excelPid) | Out-Null

Write-Host "Excel ready: PID=$excelPid  HWND=$hwnd  '$($comExcel.Caption)'" -ForegroundColor Green

# ── Write session file so run-watchdog.ps1 can pick up PID + hwnd ────────────
$sessionFile = Join-Path $PSScriptRoot ".excel-session.json"
@{ pid = [int]$excelPid; hwnd = $hwnd.ToInt64() } | ConvertTo-Json | Set-Content $sessionFile
Write-Host "Session saved: $sessionFile" -ForegroundColor Gray

# ── 4. Inject VBA freeze-simulation macro ────────────────────────────────────
if (-not $NoMacro) {
    Write-Host "`nInjecting VBA test macro..." -ForegroundColor Cyan

    # Requires: Excel Trust Center > Macro Settings >
    #           "Trust access to the VBA project object model" = ON
    try {
        $wb        = $comExcel.ActiveWorkbook
        $vbComps   = $wb.VBProject.VBComponents

        # Remove stale module from a previous run
        try { $vbComps.Remove($vbComps.Item("WatchdogTest")) } catch {}

        $module = $vbComps.Add(1)   # 1 = vbext_ct_StdModule
        $module.Name = "WatchdogTest"

        $code = @"
' ── WatchdogTest ─────────────────────────────────────────────
' Run these from Developer > Macros to exercise the watchdog.

Sub Freeze4s()
    ' Blocks the UI thread for 4s → watchdog should report FAIL
    Application.Wait Now + TimeValue("0:00:04")
End Sub

Sub Freeze2s()
    ' Blocks the UI thread for 2s → watchdog should report CAUTION
    Application.Wait Now + TimeValue("0:00:02")
End Sub

Sub FreezeShort()
    ' Blocks the UI thread for 600ms → watchdog should report CAUTION
    Application.Wait Now + TimeValue("0:00:01")
End Sub

Sub NoFreeze()
    ' Writes 1000 simple values — responsive, no freeze expected
    Dim i As Long
    For i = 1 To 1000
        Sheet1.Cells(i, 1).Value = i
    Next i
    MsgBox "NoFreeze done — watchdog should show PASS", vbInformation
End Sub
"@
        $module.CodeModule.InsertLines(1, $code)
        Write-Host "VBA module 'WatchdogTest' injected successfully." -ForegroundColor Green
        Write-Host "  Run macros from: Developer tab > Macros > select WatchdogTest.*" -ForegroundColor Gray
    } catch {
        Write-Warning "VBA injection failed: $_"
        Write-Warning "Enable 'Trust access to the VBA project object model' in Excel Trust Center > Macro Settings."
    }
}

# ── 5. Summary ────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Excel is ready. Now run:" -ForegroundColor Cyan
Write-Host "  .\run-watchdog.ps1" -ForegroundColor White
