param([string]$Profile = "guard-badge")
Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe'" | Where-Object { $_.CommandLine -like "*$Profile*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
