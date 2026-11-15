# Run this script as Administrator to enable long path support on Windows
# Right-click this file and select "Run with PowerShell"

Write-Host "Enabling Windows long path support..." -ForegroundColor Green

# Enable long paths in registry
try {
    New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" `
        -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force | Out-Null
    Write-Host "✓ Long paths enabled successfully" -ForegroundColor Green
    
    # Verify
    $result = Get-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled"
    Write-Host "Registry value set to: $($result.LongPathsEnabled)" -ForegroundColor Green
    Write-Host "`nRESTART YOUR COMPUTER for changes to take effect." -ForegroundColor Yellow
}
catch {
    Write-Host "ERROR: This script must be run as Administrator" -ForegroundColor Red
    Write-Host "Right-click the script and select 'Run with PowerShell'" -ForegroundColor Yellow
    exit 1
}
