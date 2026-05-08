using System.Runtime.InteropServices;

namespace ProcessWatchdog;

internal static class NativeMethods
{
    internal const uint WM_NULL = 0x0000;
    internal const uint SMTO_ABORTIFHUNG = 0x0002;

    [DllImport("user32.dll", SetLastError = true)]
    internal static extern IntPtr SendMessageTimeout(
        IntPtr hWnd,
        uint Msg,
        IntPtr wParam,
        IntPtr lParam,
        uint fuFlags,
        uint uTimeout,
        out IntPtr lpdwResult);

    [DllImport("user32.dll")]
    internal static extern bool IsHungAppWindow(IntPtr hwnd);

    [DllImport("user32.dll")]
    internal static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    internal static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    internal delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    internal static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);

    /// <summary>
    /// Finds a visible top-level window owned by the given PID.
    /// Needed for Excel launched via COM (/automation -Embedding) where
    /// Process.MainWindowHandle is 0 even though a window is visible.
    /// </summary>
    internal static IntPtr FindVisibleWindowForPid(int pid)
    {
        IntPtr found = IntPtr.Zero;
        EnumWindows((hWnd, _) =>
        {
            GetWindowThreadProcessId(hWnd, out uint windowPid);
            if (windowPid == (uint)pid && IsWindowVisible(hWnd))
            {
                found = hWnd;
                return false; // stop enumeration
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }
}
