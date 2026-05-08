# Excel Process Watchdog

A .NET 8 console tool that monitors Excel for UI freezes during COM add-in testing. Run it alongside Excel while your add-in injects formulas — it logs every freeze event and generates a Markdown sign-off report.

---

## Prerequisites

| Requirement | Notes |
| --- | --- |
| [.NET 8 SDK](https://aka.ms/dotnet/download) | Build and run the C# watchdog |
| Microsoft Excel | Any Office 365 / 2019 / 2021 installation |
| PowerShell 7+ | Included with Windows 11; [install here](https://aka.ms/powershell) if missing |

### One-time Excel setup — enable VBA trust

The `start-excel.ps1` script injects test macros into Excel automatically. This requires one setting:

> **Excel → File → Options → Trust Center → Trust Center Settings → Macro Settings**
> ✅ Enable **"Trust access to the VBA project object model"**

---

## Quick start

Open **two PowerShell terminals** side by side in this folder.

**Terminal 1 — prepare Excel:**

```powershell
.\start-excel.ps1
```

This launches Excel, opens a blank workbook, and injects the `WatchdogTest` VBA module.

**Terminal 2 — start monitoring:**

```powershell
.\run-watchdog.ps1
```

The watchdog attaches to Excel and begins polling every 250 ms. The live status line updates continuously:

```text
  Elapsed: 00:12 | CPU:  94.0% | Freezes: 1
```

**Trigger a test freeze** — switch to Excel and run a macro:

> **Developer → Macros → WatchdogTest.Freeze4s → Run**

You will see in Terminal 2:

```text
[10:15:32.123] FREEZE STARTED
[10:15:36.456] FREEZE ENDED — 4.333s
```

**Stop and generate the report** — press **Ctrl+C** in Terminal 2:

```text
Report written: watchdog-report-20260508-101500.md
Verdict: FAIL | Freezes: 1 | Longest: 4.333s
```

---

## Scripts

### `start-excel.ps1`

Launches Excel via COM automation, ensures a workbook is open, injects the VBA test module, and writes `.excel-session.json` so the watchdog knows which Excel instance to watch.

```powershell
.\start-excel.ps1              # launch + inject VBA macros
.\start-excel.ps1 -NoMacro    # launch only, skip VBA injection
```

If Excel is already open it attaches to the running instance instead of launching a new one.

### `run-watchdog.ps1`

Reads `.excel-session.json`, builds the C# watchdog, and starts monitoring.

```powershell
.\run-watchdog.ps1                      # default: 500ms threshold, report in current dir
.\run-watchdog.ps1 -Threshold 1000      # only report freezes > 1 second
.\run-watchdog.ps1 -Output ".\reports"  # write report to .\reports\
```

---

## VBA test macros

After running `start-excel.ps1`, open **Developer → Macros** and run any of these:

| Macro | What it does | Expected verdict |
| --- | --- | --- |
| `Freeze4s` | Blocks UI for 4 s | **FAIL** |
| `Freeze2s` | Blocks UI for 2 s | **CAUTION** |
| `FreezeShort` | Blocks UI for ~1 s | **CAUTION** |
| `NoFreeze` | Writes 1 000 cell values | **PASS** |

---

## Sign-off report

A Markdown file is written to the output directory on every Ctrl+C or Excel close.

**Verdict logic:**

| Verdict | Condition |
| --- | --- |
| ✅ **PASS** | Zero freeze events |
| ⚠️ **CAUTION** | Freezes detected, longest < 3 s |
| ❌ **FAIL** | Any freeze ≥ 3 s |

**Example report output:**

```markdown
| Field | Value |
| Verdict | ❌ FAIL |

## Freeze Events
| # | Start Time   | Duration | CPU at Freeze | Severity |
| 1 | 10:15:32.123 | 4.333s   | 94.0%         | SEVERE   |
```

The report is designed to be committed to git as a release artifact alongside the add-in version being tested.

---

## Project structure

```text
process-watchdog/
├── start-excel.ps1          # Step 1 — launch Excel + inject VBA
├── run-watchdog.ps1         # Step 2 — start the freeze monitor
├── .excel-session.json      # Runtime state (gitignored)
├── ProcessWatchdog/
│   ├── Program.cs           # Entry point + monitoring loop
│   ├── FreezeDetector.cs    # SendMessageTimeout polling
│   ├── CpuSampler.cs        # CPU% sampling
│   ├── SessionLogger.cs     # Freeze event accumulator
│   ├── ReportWriter.cs      # Markdown report generator
│   └── NativeMethods.cs     # Win32 P/Invoke declarations
├── docs/
│   └── how-it-works.md      # Architecture + diagrams
└── process-watchdog.sln
```

---

## VS Code debugging

Press **F5** — VS Code builds the project and attaches the debugger to the watchdog process. Set breakpoints in any `.cs` file before pressing F5.

> Note: the watchdog needs Excel to be running before launch. Run `start-excel.ps1` first.
