# code-server workspace image

Per-developer browser VS Code with Claude Code CLI baked in.

## Build

```bash
docker build -t devplatform/code-server:latest docker/code-server/
```

## Notes

- `--disable-file-downloads` prevents the IDE from offering "Download" on files.
  Developers can still copy/paste content (no technical defense against that — covered by NDA).
- Claude Code is installed globally (`npm i -g @anthropic-ai/claude-code`).
  Each developer authenticates with their own Anthropic / Claude Pro account on first run.
- The container runs as the `coder` user (uid 1000). Mount your workspace directory
  with matching ownership.
