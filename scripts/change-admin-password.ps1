# Explicit owner action only. Never run automatically during setup/upgrade.
param([Parameter(Mandatory=$true)][string]$UserId)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$first = Read-Host 'New unique administrator passphrase (16+ characters)' -AsSecureString
$second = Read-Host 'Confirm passphrase' -AsSecureString
$one = [IntPtr]::Zero; $two = [IntPtr]::Zero
try {
  $one = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($first)
  $two = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($second)
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($one)
  $confirm = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($two)
  if ($plain -cne $confirm) { throw 'Passphrases do not match. No change made.' }
  if ($plain.Length -lt 16) { throw 'Use at least 16 characters. No change made.' }
  $answer = Read-Host "Change ONLY the password for existing Admin id $UserId? Type CHANGE"
  if ($answer -cne 'CHANGE') { Write-Host 'Cancelled. No change made.'; exit 0 }
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = (Get-Command node.exe).Source
  $info.Arguments = '-r ts-node/register/transpile-only src/scripts/change-admin-password.ts --apply-owner-approved'
  $info.WorkingDirectory = Join-Path $root 'backend'
  $info.UseShellExecute = $false
  $info.RedirectStandardInput = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $info.CreateNoWindow = $true
  $child = [System.Diagnostics.Process]::Start($info)
  $payload = @{ userId = $UserId; password = $plain } | ConvertTo-Json -Compress
  $child.StandardInput.Write($payload)
  $child.StandardInput.Close()
  $payload = $null; $plain = $null; $confirm = $null
  $out = $child.StandardOutput.ReadToEnd()
  $err = $child.StandardError.ReadToEnd()
  $child.WaitForExit()
  if ($child.ExitCode -ne 0) { throw 'Password maintenance failed; no credentials are printed. Check the selected Admin and recovery backup permissions.' }
  Write-Host 'Password updated and verified; recovery backup created. Social sessions and encryption key unchanged.'
  Write-Host 'Existing dashboard JWTs may remain valid until expiry; password changes do not revoke issued JWTs.'
} finally {
  if ($one -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($one) }
  if ($two -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($two) }
  $plain = $null; $confirm = $null; $payload = $null
  if ($first) { $first.Dispose() }; if ($second) { $second.Dispose() }
}
