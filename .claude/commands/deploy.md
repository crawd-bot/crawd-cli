# Deploy crawd to remote Mac Mini

Deploy the crawd plugin, overlay, and restart the gateway on the remote Mac Mini (m1@62.210.193.35).

All SSH commands must prefix PATH: `export PATH=/opt/homebrew/bin:$PATH`

## Steps

Run these steps in order. Stop and report if any step fails.

### 0. Commit and push all changes

Before deploying, ensure both repos have no uncommitted changes and are pushed to remote.

**crawd-cli** (plugin):
```bash
cd /Users/m/code/crawd/alpha/crawd-cli
git status
# If there are changes, commit them
git push
```

**crawd-overlay-example** (overlay):
```bash
cd /Users/m/code/crawd/alpha/crawd-overlay-example
git status
# If there are changes, commit them
git push
```

Do NOT proceed to the next step if either repo has uncommitted changes or unpushed commits.

### 1. Build and publish crawd-cli

```bash
cd /Users/m/code/crawd/alpha/crawd-cli
pnpm build
pnpm publish --access public --no-git-checks
```

### 2. Update crawd plugin on remote

```bash
ssh m1@62.210.193.35 "export PATH=/opt/homebrew/bin:\$PATH && cd ~/openclaw-plugins && npm install crawd@<VERSION>"
```

Use the exact version from step 1 (not `npm update` which may cache stale versions).

Verify version:
```bash
ssh m1@62.210.193.35 "export PATH=/opt/homebrew/bin:\$PATH && cat ~/openclaw-plugins/node_modules/crawd/package.json | grep version | head -1"
```

### 3. Pull and update overlay on remote

```bash
ssh m1@62.210.193.35 "export PATH=/opt/homebrew/bin:\$PATH && cd ~/crawd-overlay-example && git pull && pnpm install"
```

### 4. Restart the gateway

Stop any existing gateway first, then start fresh:
```bash
ssh m1@62.210.193.35 "export PATH=/opt/homebrew/bin:\$PATH && /usr/local/bin/openclaw gateway stop 2>/dev/null; pkill -9 -f openclaw 2>/dev/null; sleep 3"
```

Start the gateway:
```bash
ssh m1@62.210.193.35 "export PATH=/opt/homebrew/bin:\$PATH && nohup /usr/local/bin/openclaw gateway run --port 18789 > /tmp/openclaw-gateway.log 2>&1 &"
```

Wait 6 seconds, then verify:
```bash
ssh m1@62.210.193.35 "tail -20 /tmp/openclaw-gateway.log"
```

Should show `[Coordinator] Started in SLEEP state` and `Backend started`.

### 5. Restart the overlay (if needed)

Check if overlay is running:
```bash
ssh m1@62.210.193.35 "pgrep -f 'vite' && echo 'running' || echo 'not running'"
```

If not running:
```bash
ssh m1@62.210.193.35 "export PATH=/opt/homebrew/bin:\$PATH && cd ~/crawd-overlay-example && nohup pnpm dev > /tmp/overlay.log 2>&1 &"
```

### 6. Report

Print a summary: what version was deployed, whether each step succeeded.
