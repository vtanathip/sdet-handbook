using System.Diagnostics;

namespace ProcessWatchdog;

/// <summary>
/// Probes Excel's UI message queue via SendMessageTimeout+WM_NULL.
/// Raises FreezeStarted / FreezeEnded events as state transitions occur.
/// </summary>
internal sealed class FreezeDetector
{
    private readonly IntPtr _hwnd;
    private readonly uint _thresholdMs;
    private bool _currentlyFrozen;
    private DateTime _freezeStart;

    internal event Action<DateTime>? FreezeStarted;
    internal event Action<DateTime, TimeSpan>? FreezeEnded;

    internal FreezeDetector(IntPtr hwnd, uint thresholdMs)
    {
        _hwnd = hwnd;
        _thresholdMs = thresholdMs;
    }

    /// <summary>
    /// Call once per poll tick. Returns true if Excel is currently frozen.
    /// </summary>
    internal bool Poll()
    {
        bool frozen = IsWindowFrozen();

        if (frozen && !_currentlyFrozen)
        {
            _currentlyFrozen = true;
            _freezeStart = DateTime.Now;
            FreezeStarted?.Invoke(_freezeStart);
        }
        else if (!frozen && _currentlyFrozen)
        {
            _currentlyFrozen = false;
            var duration = DateTime.Now - _freezeStart;
            FreezeEnded?.Invoke(DateTime.Now, duration);
        }

        return _currentlyFrozen;
    }

    internal bool IsFrozen => _currentlyFrozen;

    internal TimeSpan CurrentFreezeDuration =>
        _currentlyFrozen ? DateTime.Now - _freezeStart : TimeSpan.Zero;

    private bool IsWindowFrozen()
    {
        var sw = Stopwatch.StartNew();
        var result = NativeMethods.SendMessageTimeout(
            _hwnd,
            NativeMethods.WM_NULL,
            IntPtr.Zero,
            IntPtr.Zero,
            NativeMethods.SMTO_ABORTIFHUNG,
            _thresholdMs,
            out _);
        sw.Stop();

        // Frozen if: call returned 0 AND elapsed >= threshold (timed out)
        // or IsHungAppWindow reports hung (belt-and-suspenders)
        return result == IntPtr.Zero && sw.ElapsedMilliseconds >= _thresholdMs - 50;
    }
}
