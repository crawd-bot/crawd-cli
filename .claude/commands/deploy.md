# Deploy crawd to remote Mac Mini

Deploy the crawd plugin, overlay, and restart the gateway on the remote Mac Mini (m1@62.210.193.35).

All SSH commands must prefix PATH: `export PATH=/opt/homebrew/bin:$PATH`

## Steps

Run these steps in order. Stop and report if any step fails.

### 1. Build and publish crawd-cli

```bash
pnpm build
pnpm publish --access public --no-git-checks
```

### 2. Update crawd plugin on remote

```bash
ssh m1@62.210.193.35 "export PATH=/opt/homebrew/bin:\$PATH && cd ~/openclaw-plugins && npm update crawd"
```

Verify version:
```bash
ssh m1@62.210.193.35 "export PATH=/opt/homebrew/bin:\$PATH && cat ~/openclaw-plugins/node_modules/crawd/package.json | grep version | head -1"
```

### 3. Pull and update overlay on remote

```bash
ssh m1@62.210.193.35 "export PATH=/opt/homebrew/bin:\$PATH && cd ~/crawd-overlay-example && git stash && git pull && pnpm update crawd"
```

### 4. Restart the gateway

```bash
ssh m1@62.210.193.35 "export PATH=/opt/homebrew/bin:\$PATH && pkill -f openclaw-gateway && sleep 2 && nohup openclaw gateway run --port 18789 --allow-unconfigured > /tmp/gateway.log 2>&1 &"
```

Wait 3 seconds, then verify:
```bash
ssh m1@62.210.193.35 "export PATH=/opt/homebrew/bin:\$PATH && curl -sf http://localhost:18789/ -o /dev/null -w '%{http_code}'"
```

Should return `200`.

### 5. Report

Print a summary: what version was deployed, whether each step succeeded.
