# push_changes.ps1

# Stage all changes
git add .

# Prompt for a commit message
$commitMessage = Read-Host -Prompt "Enter commit message"

if (-not $commitMessage) {
    Write-Host "Commit message cannot be empty. Aborting."
    exit 1
}

git commit -m $commitMessage

# Push to the main branch on origin
git push origin main

Write-Host "Changes pushed to origin/main with message: $commitMessage" 