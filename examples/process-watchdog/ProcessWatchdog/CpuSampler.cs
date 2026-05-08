using System.Diagnostics;

namespace ProcessWatchdog;

/// <summary>
/// Samples CPU usage for a target process by comparing TotalProcessorTime across intervals.
/// Returns CPU% over the last sample window (0–100 per logical core, capped at 100).
/// </summary>
internal sealed class CpuSampler
{
    private readonly Process _process;
    private TimeSpan _lastCpuTime;
    private DateTime _lastSampleTime;

    internal CpuSampler(Process process)
    {
        _process = process;
        Snapshot();
    }

    /// <summary>
    /// Returns CPU% since the last call (or construction). Range: 0–100.
    /// </summary>
    internal double Sample()
    {
        _process.Refresh();

        var now = DateTime.UtcNow;
        var currentCpu = _process.TotalProcessorTime;

        var cpuDelta = currentCpu - _lastCpuTime;
        var wallDelta = now - _lastSampleTime;

        _lastCpuTime = currentCpu;
        _lastSampleTime = now;

        if (wallDelta.TotalMilliseconds <= 0)
            return 0;

        // Normalize across all logical cores so result is 0–100%
        double raw = cpuDelta.TotalMilliseconds / wallDelta.TotalMilliseconds / Environment.ProcessorCount * 100.0;
        return Math.Min(100.0, Math.Round(raw, 1));
    }

    private void Snapshot()
    {
        _process.Refresh();
        _lastCpuTime = _process.TotalProcessorTime;
        _lastSampleTime = DateTime.UtcNow;
    }
}
