$ErrorActionPreference = 'Stop'
Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    $expectedRemote = 'https://github.com/mohamedwaellll/edutrack-app.git'
    $actualRemote = git remote get-url origin
    if ($LASTEXITCODE -ne 0 -or $actualRemote -ne $expectedRemote) { throw 'Unexpected origin; verify the repository before publishing.' }
    $refs = @(
        'refs/heads/main',
        'refs/heads/develop',
        'refs/heads/feature/auth-role-access',
        'refs/heads/feature/attendance-qr',
        'refs/heads/feature/student-portal',
        'refs/heads/feature/parent-portal',
        'refs/heads/feature/admin-teacher-workflows',
        'refs/tags/pre-team-start-20261120',
        'refs/tags/team-start-20261120'
    )
    foreach ($ref in $refs) {
        git show-ref --verify --quiet $ref
        if ($LASTEXITCODE -ne 0) { throw "Missing local reference: $ref" }
    }
    git push --atomic origin @refs
    if ($LASTEXITCODE -ne 0) { throw 'Publication failed. Authenticate to GitHub or review divergent branches; do not force push.' }
    Write-Host 'Published team baseline, five feature branches, develop and backup tags.'
} finally {
    Pop-Location
}
