# push_changes.ps1

# Stage all changes
git add .

# Commit with the new message
$commitMessage = "Doc: Update todo.md with comprehensive feature list from Grok/Gemini. Added sections for Core Gameplay, Monetization/Roblox, Bugs. Integrated LBS-inspired ideas."
git commit -m $commitMessage

# Push to the main branch on origin
git push origin main

Write-Host "Changes pushed to origin/main with message: $commitMessage" 