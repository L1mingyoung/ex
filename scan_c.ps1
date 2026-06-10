$paths = @(
    'C:\Users\Li\AppData\Local',
    'C:\Users\Li\AppData\Roaming',
    'C:\Users\Li\AppData\LocalLow',
    'C:\Users\Li\.nuget',
    'C:\Users\Li\.cargo',
    'C:\Users\Li\.gradle',
    'C:\Users\Li\.m2',
    'C:\Users\Li\.conda',
    'C:\Users\Li\.vscode',
    'C:\Users\Li\.docker',
    'C:\Users\Li\.cache',
    'C:\Users\Li\.python',
    'C:\Users\Li\.node-gyp',
    'C:\Users\Li\AppData\Local\Programs',
    'C:\ProgramData',
    'C:\Program Files',
    'C:\Program Files (x86)',
    'C:\Windows\Installer',
    'C:\Windows\Temp',
    'C:\Windows\SoftwareDistribution'
)

$results = @()
foreach ($p in $paths) {
    if (Test-Path $p) {
        $s = 0
        try {
            $s = (Get-ChildItem $p -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum -ErrorAction SilentlyContinue).Sum
        } catch {}
        if ($null -eq $s) { $s = 0 }
        $mb = [math]::Round($s / 1MB, 0)
        if ($mb -ge 100) {
            $results += [PSCustomObject]@{
                SizeMB = $mb
                SizeGB = [math]::Round($s / 1GB, 1)
                Path   = $p
            }
        }
    }
}

$results | Sort-Object SizeMB -Descending | Format-Table -AutoSize
Write-Host "`nC drive free: $([math]::Round((Get-PSDrive C).Free / 1GB, 1)) GB"
