#!/usr/bin/env bash
set -e

# Configure git identity inside the workspace if env vars are set
if [ -n "${GIT_USER_NAME:-}" ] && [ -n "${GIT_USER_EMAIL:-}" ]; then
  git config --global user.name "$GIT_USER_NAME"
  git config --global user.email "$GIT_USER_EMAIL"
fi

# Use Linux keyring-free credential store for git so push tokens work without prompts
git config --global credential.helper store
git config --global pull.rebase false
git config --global init.defaultBranch main

exec "$@"
