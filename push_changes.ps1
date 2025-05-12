# push_changes.ps1

# Stage all changes
git add .

# Commit with a pre-defined message for this script update
$commitMessage = "Chore: Update push_changes.ps1 to use a predefined commit message for script tests"
git commit -m $commitMessage

# Push to the main branch on origin
git push origin main

Write-Host "Changes pushed to origin/main with message: $commitMessage" 