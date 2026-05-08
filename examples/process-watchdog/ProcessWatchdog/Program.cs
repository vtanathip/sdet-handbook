using System.Diagnostics;
using ProcessWatchdog;

// ── Parse CLI args ────────────────────────────────────────────────────────────
uint thresholdMs = 500;
string outputDir = Directory.GetCurrentDirectory();
int targetPid = 0;
long targetHwnd = 0;

for (int i = 0; i < args.Length; i++)
{
    if (args[i] == "--threshold" && i + 1 < args.Length && uint.TryParse(args[i + 1], out var t))
        thresholdMs = t;
    if (args[i] == "--output" && i + 1 < args.Length)
        outputDir = args[i + 1];
    if (args[i] == "--pid" && i + 1 < args.Length && int.TryParse(args[i + 1], out var p))
        targetPid = p;
    if (args[i] == "--hwnd" && i + 1 < args.Length && long.TryParse(args[i + 1], out var h))
        targetHwnd = h;
}

// ── Find Excel ────────────────────────────────────────────────────────────────
Process excelProcess = FindExcelProcess(targetPid);

Console.WriteLine($"Monitoring Excel PID={excelProcess.Id} (threshold={thresholdMs}ms)");
Console.WriteLine("Press Ctrl+C to stop and generate the sign-off report.");
Console.WriteLine();

// ── Setup ─────────────────────────────────────────────────────────────────────
// Resolution order:
//   1. --hwnd passed directly (from start-excel.ps1 session file — most reliable)
//   2. Process.MainWindowHandle (works for normally launched Excel)
//   3. EnumWindows fallback (for COM-launched Excel without a session file)
var hwnd = targetHwnd != 0 ? new IntPtr(targetHwnd) : excelProcess.MainWindowHandle;
if (hwnd == IntPtr.Zero)
    hwnd = NativeMethods.FindVisibleWindowForPid(excelProcess.Id);

if (hwnd == IntPtr.Zero)
{
    Console.Error.WriteLine("ERROR: Excel has no visible window. Open a workbook first.");
    return 1;
}

var detector = new FreezeDetector(hwnd, thresholdMs);
var sampler = new CpuSampler(excelProcess);
var logger = new SessionLogger();

detector.FreezeStarted += start =>
{
    Console.ForegroundColor = ConsoleColor.Yellow;
    Console.WriteLine($"\n[{start:HH:mm:ss.fff}] FREEZE STARTED");
    Console.ResetColor();
};

detector.FreezeEnded += (end, duration) =>
{
    var color = duration.TotalSeconds >= 3 ? ConsoleColor.Red : ConsoleColor.Yellow;
    Console.ForegroundColor = color;
    Console.WriteLine($"[{end:HH:mm:ss.fff}] FREEZE ENDED — {duration.TotalSeconds:F3}s");
    Console.ResetColor();
    logger.RecordFreezeEnd(end, duration);
};

// ── Monitoring loop ───────────────────────────────────────────────────────────
using var cts = new CancellationTokenSource();
Console.CancelKeyPress += (_, e) =>
{
    e.Cancel = true;
    cts.Cancel();
};

try
{
    while (!cts.Token.IsCancellationRequested)
    {
        excelProcess.Refresh();
        if (excelProcess.HasExited)
        {
            Console.WriteLine("\nExcel has closed.");
            break;
        }

        double cpu = sampler.Sample();
        logger.UpdateCpu(cpu);
        bool frozen = detector.Poll();

        var elapsed = DateTime.Now - logger.SessionStart;
        var freezeInfo = frozen
            ? $" | FROZEN {detector.CurrentFreezeDuration.TotalSeconds:F1}s"
            : "";
        Console.Write($"\r  Elapsed: {elapsed:mm\\:ss} | CPU: {cpu,5:F1}% | Freezes: {logger.FreezeCount}{freezeInfo}   ");

        await Task.Delay(250, cts.Token);
    }
}
catch (OperationCanceledException) { }

Console.WriteLine();
Console.WriteLine();

// ── Generate report ───────────────────────────────────────────────────────────
logger.Complete();
var reportPath = ReportWriter.Write(logger, excelProcess, outputDir, thresholdMs);

Console.ForegroundColor = ConsoleColor.Cyan;
Console.WriteLine($"Report written: {reportPath}");
Console.ResetColor();

var verdict = logger.FreezeCount == 0 ? "PASS"
    : logger.LongestFreeze.TotalSeconds >= 3 ? "FAIL"
    : "CAUTION";
Console.WriteLine($"Verdict: {verdict} | Freezes: {logger.FreezeCount} | Longest: {logger.LongestFreeze.TotalSeconds:F3}s");

return verdict == "FAIL" ? 2 : verdict == "CAUTION" ? 1 : 0;

// ── Helpers ───────────────────────────────────────────────────────────────────
static Process FindExcelProcess(int targetPid)
{
    // Direct PID supplied — resolve immediately (window check happens in caller)
    if (targetPid > 0)
    {
        try { return Process.GetProcessById(targetPid); }
        catch
        {
            Console.Error.WriteLine($"ERROR: No process found with PID={targetPid}.");
            Environment.Exit(1);
        }
    }

    var candidates = Process.GetProcessesByName("EXCEL");

    if (candidates.Length == 0)
    {
        Console.Error.WriteLine("ERROR: No running Excel process found. Run start-excel.ps1 first.");
        Environment.Exit(1);
    }

    if (candidates.Length == 1)
        return candidates[0];

    Console.WriteLine("Multiple Excel instances found:");
    for (int i = 0; i < candidates.Length; i++)
        Console.WriteLine($"  [{i + 1}] PID={candidates[i].Id}  {candidates[i].MainWindowTitle}");

    Console.Write($"Select [1-{candidates.Length}]: ");

    if (int.TryParse(Console.ReadLine(), out int choice) && choice >= 1 && choice <= candidates.Length)
        return candidates[choice - 1];

    Console.Error.WriteLine("Invalid selection.");
    Environment.Exit(1);
    throw new UnreachableException();
}
