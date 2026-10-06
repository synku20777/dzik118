#Requires -Version 7.0
<#
Windows deployment helper. Setup prompts privately and saves a DPAPI-encrypted
SecureString outside both repositories. Verify never deploys or changes DNS.
Deploy retains the project's existing build/migration/deployment gates.
#>
[CmdletBinding()]
param(
    [ValidateSet('Setup', 'Verify', 'Deploy')]
    [string] $Action = 'Verify',
    [ValidateSet('App', 'Website')]
    [string] $Project = 'App',
    [string] $CredentialPath = (Join-Path $env:LOCALAPPDATA 'Namkopa/Cloudflare/deploy-token.xml')
)

$ErrorActionPreference = 'Stop'
if (-not [OperatingSystem]::IsWindows()) {
    throw 'This helper requires Windows DPAPI. Use your secret manager on other platforms.'
}
$deploymentAccountId = '81a1d4cff6d57963d98d8e847bb6c0b3'
$deploymentZoneId = '2a3bd97bc827676d093647ecee871be6'

function Test-DeploymentAccess([System.Security.SecureString] $DeploymentToken) {
    $checks = @(
        @{ Label = 'Account token'; Path = "/accounts/$deploymentAccountId/tokens/verify" },
        @{ Label = 'App Worker'; Path = "/accounts/$deploymentAccountId/workers/scripts/property-billing/deployments" },
        @{ Label = 'Website Worker'; Path = "/accounts/$deploymentAccountId/workers/scripts/namkopa-website/deployments" },
        @{ Label = 'Namkopa routes'; Path = "/zones/$deploymentZoneId/workers/routes" }
    )
    foreach ($check in $checks) {
        try {
            $response = Invoke-RestMethod -Uri ("https://api.cloudflare.com/client/v4" + $check.Path) `
                -Method Get -Authentication Bearer -Token $DeploymentToken -TimeoutSec 30
        } catch {
            # Never print headers, the credential, or a complete API error body.
            throw "Cloudflare access check failed for $($check.Label). Check token scope and expiry."
        }
        if (-not $response.success) {
            throw "Cloudflare access check failed for $($check.Label)."
        }
        if ($check.Label -eq 'Account token' -and $response.result.status -ne 'active') {
            throw 'The deployment token is not active.'
        }
        Write-Host "$($check.Label): verified"
    }
    # Read checks establish that this credential reaches the intended resources.
    # The dashboard policy review establishes write scope; this does not deploy.
}

$deploymentToken = $null
try {
    if ($Action -eq 'Setup') {
        $deploymentToken = Read-Host 'Paste namkopa-deploy token (hidden)' -AsSecureString
        if ($deploymentToken.Length -eq 0) { throw 'No token entered.' }
        Test-DeploymentAccess $deploymentToken
        $credentialDirectory = Split-Path -Parent $CredentialPath
        New-Item -ItemType Directory -Path $credentialDirectory -Force | Out-Null
        $deploymentToken | Export-Clixml -LiteralPath $CredentialPath
        Write-Host 'Verified token saved with Windows user/machine encryption. No deployment performed.'
    } else {
        if (-not (Test-Path -LiteralPath $CredentialPath -PathType Leaf)) {
            throw 'No encrypted deployment token saved. Run this script with -Action Setup first.'
        }
        $deploymentToken = Import-Clixml -LiteralPath $CredentialPath
        if ($deploymentToken -isnot [System.Security.SecureString]) {
            throw 'The saved credential has an unexpected format.'
        }
        Test-DeploymentAccess $deploymentToken
        if ($Action -eq 'Deploy') {
            $appDirectory = Split-Path -Parent $PSScriptRoot
            $projectDirectory = if ($Project -eq 'App') {
                $appDirectory
            } else {
                Join-Path (Split-Path -Parent $appDirectory) 'namkopa-website'
            }
            if (-not (Test-Path -LiteralPath (Join-Path $projectDirectory 'package.json'))) {
                throw 'The selected project directory is missing.'
            }
            $previousToken = [Environment]::GetEnvironmentVariable('CLOUDFLARE_API_TOKEN', 'Process')
            $previousAccount = [Environment]::GetEnvironmentVariable('CLOUDFLARE_ACCOUNT_ID', 'Process')
            try {
                $env:CLOUDFLARE_API_TOKEN = ConvertFrom-SecureString $deploymentToken -AsPlainText
                $env:CLOUDFLARE_ACCOUNT_ID = $deploymentAccountId
                Push-Location -LiteralPath $projectDirectory
                try {
                    if ($Project -eq 'App') {
                        & npm.cmd run deploy:check-secrets
                        if ($LASTEXITCODE -ne 0) { throw 'Worker-secret preflight failed.' }
                    }
                    & npm.cmd run deploy
                    if ($LASTEXITCODE -ne 0) { throw 'Deployment failed.' }
                } finally {
                    Pop-Location
                }
            } finally {
                [Environment]::SetEnvironmentVariable('CLOUDFLARE_API_TOKEN', $previousToken, 'Process')
                [Environment]::SetEnvironmentVariable('CLOUDFLARE_ACCOUNT_ID', $previousAccount, 'Process')
            }
        }
    }
} finally {
    if ($deploymentToken -is [System.Security.SecureString]) { $deploymentToken.Dispose() }
}
