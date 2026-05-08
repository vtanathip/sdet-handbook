# How It Works

## Overview

Excel Process Watchdog detects UI-thread freezes in Excel by probing its message queue at 250 ms intervals using the Windows `SendMessageTimeout` API. Any probe that takes longer than the configured threshold (default 500 ms) is recorded as a freeze event. At the end of a session, all events are compiled into a Markdown sign-off report.

---

## End-to-end flow

```mermaid
sequenceDiagram
    participant QA as QA Engineer
    participant PS1 as start-excel.ps1
    participant Excel as Excel (COM)
    participant Session as .excel-session.json
    participant PS2 as run-watchdog.ps1
    participant Dog as ProcessWatchdog.exe
    participant Report as watchdog-report-*.md

    QA->>PS1: .\start-excel.ps1
    PS1->>Excel: New-Object -ComObject Excel.Application
    Excel-->>PS1: COM handle (Hwnd, PID)
    PS1->>Excel: Inject WatchdogTest VBA module
    PS1->>Session: Write { pid, hwnd }

    QA->>PS2: .\run-watchdog.ps1
    PS2->>Session: Read { pid, hwnd }
    PS2->>Dog: dotnet run --pid X --hwnd Y

    loop Every 250 ms
        Dog->>Excel: SendMessageTimeout(WM_NULL, 500ms)
        alt Excel responds in time
            Excel-->>Dog: Returns immediately
            Dog->>Dog: Record CPU%, status = RESPONSIVE
        else Excel does not respond
            Dog->>Dog: FREEZE STARTED — record timestamp
            Dog->>Dog: Continue polling until response resumes
            Dog->>Dog: FREEZE ENDED — record duration + CPU%
        end
    end

    QA->>Dog: Ctrl+C
    Dog->>Report: Write Markdown sign-off report
    Dog-->>QA: Verdict: PASS / CAUTION / FAIL
```

---

## Component map

```mermaid
graph TD
    subgraph PowerShell["PowerShell scripts"]
        SE[start-excel.ps1]
        RW[run-watchdog.ps1]
    end

    subgraph CSharp["ProcessWatchdog (C#)"]
        PG[Program.cs\nEntry point + loop]
        FD[FreezeDetector\nSendMessageTimeout probe]
        CS[CpuSampler\nTotalProcessorTime delta]
        SL[SessionLogger\nFreezeEvent accumulator]
        RWr[ReportWriter\nMarkdown generator]
        NM[NativeMethods\nWin32 P/Invoke]
    end

    Excel[Microsoft Excel]
    Session[.excel-session.json]
    Report[watchdog-report-*.md]

    SE -->|COM automation| Excel
    SE -->|pid + hwnd| Session
    RW -->|reads| Session
    RW -->|dotnet run| PG

    PG --> FD
    PG --> CS
    PG --> SL
    PG --> RWr

    FD -->|SendMessageTimeout| NM
    NM -->|Win32 user32.dll| Excel

    CS -->|TotalProcessorTime| Excel
    SL --> RWr
    RWr --> Report
```

---

## Freeze detection algorithm

The core probe is a single Win32 call repeated every 250 ms:

```csharp
SendMessageTimeout(
    hwnd,               // Excel's main window handle
    WM_NULL,            // harmless message — no action required
    0, 0,
    SMTO_ABORTIFHUNG,   // return immediately if already hung
    500,                // timeout in ms (configurable)
    out _)
```

**Why `WM_NULL` + `SendMessageTimeout`?**

Windows' message pump is the heartbeat of any UI thread. If a thread is blocked — waiting on a lock, a COM call, or a synchronous I/O — it stops draining its message queue. `SendMessageTimeout` attempts to deliver a message synchronously: if the target thread retrieves and processes it within the timeout, the call returns non-zero (responsive). If not, it returns zero (frozen).

This is the same mechanism Windows Task Manager uses to show "(Not Responding)".

**State machine:**

```text
          ┌─────────────────────────────────────────────────────┐
          │                    POLL TICK (every 250ms)          │
          │                                                      │
  ┌───────▼───────┐    result == 0        ┌───────────────────┐ │
  │  RESPONSIVE   │──────────────────────►│     FROZEN        │ │
  │               │                       │  emit FreezeStart │ │
  │  emit nothing │◄──────────────────────│  record timestamp │ │
  └───────────────┘    result != 0        └───────────────────┘ │
          │                                                      │
          └─────────────────────────────────────────────────────┘

  On transition FROZEN → RESPONSIVE:
    duration = now − freezeStart
    emit FreezeEnded(duration, peakCpu%)
    SessionLogger.RecordFreezeEnd(...)
```

---

## CPU correlation

On every poll tick, `CpuSampler` computes CPU% since the last tick:

```text
cpuDelta  = Process.TotalProcessorTime(now) − TotalProcessorTime(last)
wallDelta = now − last
cpu%      = cpuDelta.ms / (wallDelta.ms × logicalCores) × 100
```

This is paired with each freeze event, giving the tester a diagnostic signal:

| Pattern | Interpretation |
| --- | --- |
| High CPU + frozen | Excel is busy calculating (expected during formula injection) |
| Low CPU + frozen | Possible deadlock, COM re-entrancy, or I/O wait — investigate |

---

## Session file

`start-excel.ps1` writes `.excel-session.json` after launching Excel:

```json
{
  "pid": 29144,
  "hwnd": 1116902
}
```

**Why store the `hwnd`?**
Excel launched via COM (`/automation -Embedding`) has `Process.MainWindowHandle = 0` in .NET — the window exists but .NET's process API doesn't recognise it as the main window. The COM object's `Hwnd` property gives the real handle. Storing it in the session file lets `run-watchdog.ps1` pass it directly to the C# app, bypassing the unreliable `Process.MainWindowHandle`.

`run-watchdog.ps1` falls back through three strategies if no session file exists:

```text
1. --hwnd from session file       ← most reliable (always used when available)
2. Process.MainWindowHandle       ← works for normally-launched Excel
3. EnumWindows scan               ← last resort: enumerate all visible windows for the PID
```

---

## Sign-off verdict

Computed from `SessionLogger` at report time:

```text
FreezeCount == 0              → PASS   (exit code 0)
LongestFreeze < 3 s           → CAUTION (exit code 1)
LongestFreeze >= 3 s          → FAIL   (exit code 2)
```

The exit code can be read by a CI pipeline to gate release builds automatically.

---

## Data flow summary

```text
Excel UI thread
      │
      │  WM_NULL probe (250ms interval)
      ▼
FreezeDetector ──► freeze event ──► SessionLogger ──► FreezeEvent list
      │                                                      │
CpuSampler ──────────────────────────────────────────────────┘
                                                             │
                                                      ReportWriter
                                                             │
                                               watchdog-report-*.md
```
