# Process Watchdog

A C# console application built with .NET 8.

## Prerequisites

- [.NET 8 SDK](https://aka.ms/dotnet/download)
- [VS Code](https://code.visualstudio.com/) with the **C# Dev Kit** extension (`ms-dotnettools.csdevkit`)

## Run

```bash
cd ProcessWatchdog
dotnet run
```

## Build only

```bash
dotnet build
```

## Project structure

```text
ProcessWatchdog/
├── Program.cs          # Entry point
└── ProcessWatchdog.csproj
process-watchdog.sln    # Solution file (VS Code C# Dev Kit uses this)
```

## VS Code setup

1. Open this folder in VS Code
2. Accept the prompt to install recommended extensions (C# Dev Kit)
3. Press `F5` — VS Code builds the project and attaches the debugger

You can set breakpoints in `Program.cs` before pressing `F5` and execution will pause there.
