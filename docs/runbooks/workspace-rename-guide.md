# Workspace Rename Guide

This runbook provides step-by-step instructions for renaming the local workspace directory and updating git remotes to align with the upstream repository, ensuring automation scripts and CI/CD pipelines function correctly.

## 1. Overview

**Current State:** Local development runs from `codex-synaptic-clone` directory  
**Target State:** Align directory name with upstream `github.com/clduab11/codex-synaptic`  
**Goal:** Ensure automation recipes, CI/CD pipelines, and release packaging resolve assets correctly

## 2. Why This Matters

### Automation Dependencies

Many automation scripts and tools reference the workspace directory name:
- **Relative Path Resolution** – Scripts using `__dirname` or relative imports
- **CI/CD Pipelines** – GitHub Actions, GitLab CI expecting specific paths
- **Release Packaging** – Docker builds, npm packages using directory name conventions
- **Documentation** – References to project paths in docs and examples

### Consistency Benefits

- **Reduced Confusion** – Developers expect directory name to match repository name
- **Simplified Onboarding** – New contributors can clone and start working immediately
- **Automated Tooling** – Many tools auto-detect project name from directory
- **Release Quality** – Package names and artifacts match repository identity

## 3. Pre-Rename Checklist

Before proceeding, ensure you've completed these steps:

### ✅ Save Your Work

```bash
# Commit all pending changes
cd /path/to/codex-synaptic-clone
git add .
git commit -m "Save work before workspace rename"

# Push to remote
git push origin <your-branch>
```

### ✅ Note Current State

```bash
# Document current branch
git branch --show-current > /tmp/current-branch.txt

# Document current remote
git remote -v > /tmp/current-remote.txt

# List any local-only branches
git branch --list > /tmp/local-branches.txt
```

### ✅ Backup Local Work

```bash
# Create a backup of uncommitted work (if any)
git stash save "Pre-rename backup"

# List stashes for reference
git stash list > /tmp/stashes.txt

# Optional: Create a full backup
cd ..
tar -czf codex-synaptic-clone-backup-$(date +%Y%m%d).tar.gz codex-synaptic-clone/
```

### ✅ Stop Running Processes

```bash
# Stop any running codex-synaptic services
codex-synaptic background stop

# Kill any running node processes
pkill -f "codex-synaptic"

# Verify no processes remain
ps aux | grep codex-synaptic
```

## 4. Rename Procedure

Follow these steps in order:

### Step 1: Navigate to Parent Directory

```bash
# Change to the parent directory containing codex-synaptic-clone
cd /path/to/parent

# Verify you're in the right place
ls -la | grep codex-synaptic-clone
```

### Step 2: Rename the Directory

```bash
# Perform the rename
mv codex-synaptic-clone codex-synaptic

# Verify the rename succeeded
ls -la | grep codex-synaptic
```

### Step 3: Enter Renamed Directory

```bash
# Navigate into the renamed directory
cd codex-synaptic

# Confirm you're in the right place
pwd
# Expected: /path/to/parent/codex-synaptic
```

### Step 4: Verify Git Remote

```bash
# Check current remote configuration
git remote -v

# Expected output:
# origin  https://github.com/clduab11/codex-synaptic.git (fetch)
# origin  https://github.com/clduab11/codex-synaptic.git (push)
```

### Step 5: Update Remote URL (If Needed)

```bash
# If remote URL is incorrect, update it
git remote set-url origin https://github.com/clduab11/codex-synaptic.git

# Verify the update
git remote -v
```

### Step 6: Test Remote Connectivity

```bash
# Test fetch from remote
git fetch origin

# Verify connection succeeded
# Expected: Should fetch latest refs without errors

# Test push to remote (dry-run)
git push --dry-run origin <your-branch>
```

### Step 7: Update Branch Tracking (If Needed)

```bash
# Check branch tracking
git branch -vv

# If tracking is broken, re-establish it
git branch --set-upstream-to=origin/<your-branch> <your-branch>
```

## 5. Post-Rename Verification

Ensure everything works correctly after the rename:

### ✅ Node.js Dependencies

```bash
# Rebuild dependencies (in case of path-dependent modules)
npm install

# Verify no errors
echo $?  # Should be 0
```

### ✅ Build System

```bash
# Run build
npm run build

# Verify build succeeded
ls -la dist/
```

### ✅ Tests

```bash
# Run test suite
npm test

# Verify tests pass
echo $?  # Should be 0
```

### ✅ CLI Functionality

```bash
# Test CLI commands
codex-synaptic system status

# If using global link, may need to re-link
npm unlink
npm link

# Test again
codex-synaptic system status
```

### ✅ Automation Scripts

```bash
# Search for hardcoded paths referencing old directory name
grep -r "codex-synaptic-clone" . --exclude-dir=node_modules --exclude-dir=.git

# Update any found references to "codex-synaptic"
```

### ✅ Git Operations

```bash
# Test git pull
git pull origin <your-branch>

# Test git push
git push origin <your-branch>

# Verify both work without errors
```

## 6. Update Automation References

After renaming, update these common locations:

### CI/CD Configuration Files

```bash
# GitHub Actions
cat .github/workflows/*.yml | grep -i "codex-synaptic-clone"

# Update any references to use "codex-synaptic"
```

### Documentation

```bash
# Search documentation for old path references
grep -r "codex-synaptic-clone" docs/ README.md AGENTS.md

# Update documentation to reflect new path
```

### Scripts

```bash
# Check automation scripts
grep -r "codex-synaptic-clone" scripts/

# Update script paths
```

### Configuration Files

```bash
# Check config files
grep -r "codex-synaptic-clone" config/

# Update any hardcoded paths
```

## 7. Troubleshooting

### Issue: Git Push Fails After Rename

**Symptom:**
```
fatal: unable to access 'https://github.com/...': Could not resolve host
```

**Diagnosis:**
```bash
# Check remote URL
git remote -v
```

**Solution:**
```bash
# Update remote URL
git remote set-url origin https://github.com/clduab11/codex-synaptic.git

# Verify and retry
git remote -v
git push origin <your-branch>
```

### Issue: npm link Broken After Rename

**Symptom:**
```bash
codex-synaptic: command not found
```

**Diagnosis:**
```bash
# Check global npm links
npm ls -g --depth=0 | grep codex-synaptic
```

**Solution:**
```bash
# Remove old link
npm unlink -g codex-synaptic

# Re-establish link from new location
cd /path/to/codex-synaptic
npm link

# Verify
which codex-synaptic
codex-synaptic --version
```

### Issue: Tests Fail After Rename

**Symptom:** Tests that passed before now fail

**Diagnosis:**
```bash
# Check for path-dependent tests
grep -r "codex-synaptic-clone" tests/

# Check for absolute path assumptions
grep -r "/codex-synaptic-clone" tests/
```

**Solution:**
```bash
# Update test fixtures and mocks
# Replace hardcoded paths with relative paths or environment variables

# Re-run tests
npm test
```

### Issue: Build Artifacts Reference Old Path

**Symptom:** Built files contain references to old directory

**Diagnosis:**
```bash
# Check build output
grep -r "codex-synaptic-clone" dist/
```

**Solution:**
```bash
# Clean build artifacts
rm -rf dist/

# Rebuild from scratch
npm run build

# Verify clean output
grep -r "codex-synaptic-clone" dist/  # Should return nothing
```

## 8. Rollback Procedure (If Needed)

If issues arise and you need to revert:

### Step 1: Rename Back

```bash
cd /path/to/parent
mv codex-synaptic codex-synaptic-clone
cd codex-synaptic-clone
```

### Step 2: Restore Remote URL

```bash
# If you changed the remote URL, restore it
git remote set-url origin <original-url>

# Verify
git remote -v
```

### Step 3: Rebuild Dependencies

```bash
# Rebuild to reset any path dependencies
npm install

# Re-link CLI
npm unlink
npm link
```

### Step 4: Verify Functionality

```bash
# Test basic operations
npm test
npm run build
codex-synaptic system status
```

## 9. Best Practices

### Before Renaming

- ✅ **Communicate** – Inform team members before renaming shared workspaces
- ✅ **Document** – Note current state (branches, remotes, uncommitted work)
- ✅ **Backup** – Create a full backup before proceeding
- ✅ **Stop Services** – Ensure no processes are running from the directory

### During Renaming

- ✅ **Follow Steps** – Complete each step in order without skipping
- ✅ **Verify Each Step** – Check output before proceeding to next step
- ✅ **Test Immediately** – Verify git operations work after rename

### After Renaming

- ✅ **Search Thoroughly** – Find all references to old directory name
- ✅ **Update Docs** – Keep documentation consistent with new structure
- ✅ **Test Comprehensively** – Run full test suite and manual verification
- ✅ **Monitor CI/CD** – Watch first automated builds for path issues

## 10. Automated Rename Script (Optional)

For future renames, consider this automated script:

```bash
#!/bin/bash
# rename-workspace.sh

set -e  # Exit on error

OLD_NAME="codex-synaptic-clone"
NEW_NAME="codex-synaptic"
REMOTE_URL="https://github.com/clduab11/codex-synaptic.git"

echo "=== Codex-Synaptic Workspace Rename ==="
echo "Old name: $OLD_NAME"
echo "New name: $NEW_NAME"
echo "Remote: $REMOTE_URL"
echo ""

# Confirm with user
read -p "Proceed with rename? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Rename cancelled"
    exit 1
fi

# Navigate to parent
cd ..

# Perform rename
echo "Renaming directory..."
mv "$OLD_NAME" "$NEW_NAME"

# Enter new directory
cd "$NEW_NAME"

# Update remote
echo "Updating git remote..."
git remote set-url origin "$REMOTE_URL"

# Verify remote
echo "Verifying remote connectivity..."
git fetch origin

# Rebuild dependencies
echo "Rebuilding dependencies..."
npm install

# Re-link CLI
echo "Re-linking CLI..."
npm unlink 2>/dev/null || true
npm link

# Run tests
echo "Running tests..."
npm test

# Summary
echo ""
echo "=== Rename Complete ==="
echo "Directory: $PWD"
echo "Remote: $(git remote -v | grep fetch)"
echo "Branch: $(git branch --show-current)"
echo ""
echo "Next steps:"
echo "1. Search for '$OLD_NAME' references: grep -r '$OLD_NAME' ."
echo "2. Update documentation and configs"
echo "3. Test automation scripts"
```

## 11. Related Documentation

- **Git Workflows:** `CONTRIBUTING.md`
- **CI/CD Setup:** `.github/workflows/README.md`
- **Automation Scripts:** `scripts/README.md`
- **Project Structure:** `README.md`

---

**Last Updated:** 2025-11-05  
**Maintainer:** Codex-Synaptic Platform Team  
**Status:** Production-Ready
