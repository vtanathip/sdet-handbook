namespace ProcessWatchdog;

internal sealed record FreezeEvent(
    DateTime StartTime,
    DateTime EndTime,
    TimeSpan Duration,
    double PeakCpuPercent)
{
    internal string Severity => Duration.TotalSeconds switch
    {
        >= 3.0 => "SEVERE",
        >= 1.0 => "MODERATE",
        _ => "MINOR"
    };
}

internal sealed class SessionLogger
{
    private readonly List<FreezeEvent> _events = new();
    private double _lastCpu;

    internal DateTime SessionStart { get; } = DateTime.Now;
    internal DateTime SessionEnd { get; private set; }
    internal IReadOnlyList<FreezeEvent> Events => _events;

    internal void UpdateCpu(double cpuPercent) => _lastCpu = cpuPercent;

    internal void RecordFreezeEnd(DateTime endTime, TimeSpan duration)
    {
        _events.Add(new FreezeEvent(
            StartTime: endTime - duration,
            EndTime: endTime,
            Duration: duration,
            PeakCpuPercent: _lastCpu));
    }

    internal void Complete() => SessionEnd = DateTime.Now;

    internal TimeSpan SessionDuration => (SessionEnd == default ? DateTime.Now : SessionEnd) - SessionStart;
    internal int FreezeCount => _events.Count;
    internal TimeSpan TotalFreezeTime => TimeSpan.FromTicks(_events.Sum(e => e.Duration.Ticks));
    internal TimeSpan LongestFreeze => _events.Count > 0 ? _events.Max(e => e.Duration) : TimeSpan.Zero;
    internal TimeSpan AverageFreeze => _events.Count > 0
        ? TimeSpan.FromTicks((long)_events.Average(e => e.Duration.Ticks))
        : TimeSpan.Zero;
}
