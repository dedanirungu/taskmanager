// Thin wrapper around dockerode for the operations the platform needs:
//   - create/start/stop a developer's code-server container
//   - run arbitrary git commands inside a container (claim/submit flows)
//
// All git work happens inside the developer's container so that file changes
// they made via code-server are picked up.
import Docker from 'dockerode';
import fs from 'node:fs/promises';
import path from 'node:path';
import { authenticatedCloneUrl, tokenForProject } from './github.js';

const docker = new Docker({
  socketPath: (process.env.DOCKER_HOST || 'unix:///var/run/docker.sock').replace('unix://', ''),
});

const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || '/srv/workspaces';
const CODE_SERVER_IMAGE = process.env.CODE_SERVER_IMAGE || 'devplatform/code-server:latest';

// Platform-wide commit identity. Used as the default author on every commit
// the platform makes via "submit"/"checkpoint", so that clients only ever see
// the operator's identity — never the subcontracted developer's.
// Per-project override (projects.git_author_name/email) takes precedence.
const PLATFORM_GIT_NAME  = process.env.PLATFORM_GIT_NAME  || process.env.GITHUB_USER  || 'devplatform';
const PLATFORM_GIT_EMAIL = process.env.PLATFORM_GIT_EMAIL || process.env.GITHUB_EMAIL || 'devplatform@localhost';

export function effectiveCommitIdentity(project) {
  if (project?.git_author_name && project?.git_author_email) {
    return { name: project.git_author_name, email: project.git_author_email };
  }
  return { name: PLATFORM_GIT_NAME, email: PLATFORM_GIT_EMAIL };
}

export function workspaceHostPath(subdomain, sub = '') {
  return path.join(WORKSPACE_ROOT, subdomain, sub);
}

export async function ensureWorkspaceDirs(subdomain) {
  for (const sub of ['projects', 'config', 'claude']) {
    const p = workspaceHostPath(subdomain, sub);
    await fs.mkdir(p, { recursive: true, mode: 0o755 });
    // code-server runs as uid 1000 inside the container; chown so it can write.
    try { await fs.chown(p, 1000, 1000); } catch (err) {
      // If we're not running as root we can't chown — that's OK in local dev.
      if (err.code !== 'EPERM') throw err;
    }
  }
}

// previews: [{ name, internal_port, host_port }]
//   8080 (IDE) is always exposed at hostPort. Each preview adds another
//   loopback binding host_port → internal_port.
//
// Note: GIT_USER_NAME / GIT_USER_EMAIL passed to the container are the
// PLATFORM identity (not the developer's). Clients should not see
// subcontracted developer names in commit history.
export async function createOrStartWorkspaceContainer({
  containerName,
  subdomain,
  password,
  hostPort,
  previews = [],
}) {
  if (!hostPort) throw new Error('hostPort required');
  await ensureWorkspaceDirs(subdomain);

  const desired = buildPortBindings(hostPort, previews);

  try {
    const container = docker.getContainer(containerName);
    const info = await container.inspect();
    const existing = info.HostConfig?.PortBindings || {};

    if (portBindingsEqual(existing, desired)) {
      if (!info.State.Running) await container.start();
      return container;
    }

    // Port set changed — must recreate (PortBindings are immutable post-create).
    console.log(`[docker] preview ports changed for ${containerName}, recreating`);
    if (info.State.Running) await container.stop({ t: 10 });
    await container.remove();
  } catch (err) {
    if (err.statusCode !== 404) throw err;
  }

  const container = await docker.createContainer({
    Image: CODE_SERVER_IMAGE,
    name: containerName,
    Env: [
      `PASSWORD=${password}`,
      `GIT_USER_NAME=${PLATFORM_GIT_NAME}`,
      `GIT_USER_EMAIL=${PLATFORM_GIT_EMAIL}`,
    ],
    HostConfig: {
      RestartPolicy: { Name: 'unless-stopped' },
      Binds: [
        `${workspaceHostPath(subdomain, 'projects')}:/home/coder/projects`,
        `${workspaceHostPath(subdomain, 'config')}:/home/coder/.config`,
        `${workspaceHostPath(subdomain, 'claude')}:/home/coder/.claude`,
      ],
      // Loopback-only — host nginx is the only thing that should reach these.
      PortBindings: desired,
    },
    ExposedPorts: Object.fromEntries(Object.keys(desired).map((k) => [k, {}])),
    Labels: {
      'devplatform.role': 'workspace',
      'devplatform.subdomain': subdomain,
    },
  });

  await container.start();
  return container;
}

function buildPortBindings(idePort, previews) {
  const out = {
    '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: String(idePort) }],
  };
  for (const p of previews) {
    out[`${p.internal_port}/tcp`] = [{ HostIp: '127.0.0.1', HostPort: String(p.host_port) }];
  }
  return out;
}

function portBindingsEqual(a, b) {
  const ak = Object.keys(a).sort();
  const bk = Object.keys(b).sort();
  if (ak.length !== bk.length) return false;
  for (let i = 0; i < ak.length; i++) {
    if (ak[i] !== bk[i]) return false;
    const av = (a[ak[i]] || [])[0] || {};
    const bv = (b[bk[i]] || [])[0] || {};
    if (String(av.HostPort) !== String(bv.HostPort)) return false;
    if (String(av.HostIp || '') !== String(bv.HostIp || '')) return false;
  }
  return true;
}

export async function stopWorkspaceContainer(containerName) {
  try {
    const c = docker.getContainer(containerName);
    await c.stop({ t: 10 });
  } catch (err) {
    if (err.statusCode !== 304 && err.statusCode !== 404) throw err;
  }
}

export async function removeWorkspaceContainer(containerName) {
  try {
    const c = docker.getContainer(containerName);
    await c.remove({ force: true });
  } catch (err) {
    if (err.statusCode !== 404) throw err;
  }
}

// Run a shell command inside the named container as the `coder` user, return {stdout, stderr, exitCode}.
export async function execInContainer(containerName, command, { workDir, env = [] } = {}) {
  const container = docker.getContainer(containerName);
  const exec = await container.exec({
    Cmd: ['bash', '-lc', command],
    AttachStdout: true,
    AttachStderr: true,
    User: 'coder',
    WorkingDir: workDir,
    Env: env,
  });

  const stream = await exec.start({ hijack: true, stdin: false });

  return await new Promise((resolve, reject) => {
    const stdoutChunks = [];
    const stderrChunks = [];

    const stdoutWritable = {
      write: (chunk) => stdoutChunks.push(chunk),
      end: () => {},
    };
    const stderrWritable = {
      write: (chunk) => stderrChunks.push(chunk),
      end: () => {},
    };

    docker.modem.demuxStream(stream, stdoutWritable, stderrWritable);

    stream.on('end', async () => {
      try {
        const info = await exec.inspect();
        resolve({
          stdout: Buffer.concat(stdoutChunks).toString('utf8'),
          stderr: Buffer.concat(stderrChunks).toString('utf8'),
          exitCode: info.ExitCode,
        });
      } catch (err) {
        reject(err);
      }
    });
    stream.on('error', reject);
  });
}

// Ensure a project repo is cloned inside a developer's container.
// Path inside container: /home/coder/projects/<project.slug>
//
// If the project has its own commit author configured (git_author_name + git_author_email),
// we write those into the repo's *local* git config so they override the container-wide
// developer identity for any operation in this directory — including ad-hoc `git commit`
// the developer might run in the terminal.
export async function ensureProjectClonedInContainer(containerName, project) {
  const projectDir = `/home/coder/projects/${project.slug}`;
  const cloneUrl = authenticatedCloneUrl(project.github_repo, tokenForProject(project));

  const check = await execInContainer(
    containerName,
    `if [ -d "${projectDir}/.git" ]; then echo exists; else echo missing; fi`,
  );

  if (check.stdout.trim() === 'exists') {
    const pull = await execInContainer(
      containerName,
      `git fetch origin && git checkout ${project.default_branch} && git pull --ff-only`,
      { workDir: projectDir },
    );
    if (pull.exitCode !== 0) {
      console.warn(`[docker] fetch/pull failed in ${containerName} for ${project.slug}:`, pull.stderr);
    }
    await writeProjectGitIdentity(containerName, projectDir, project);
    return projectDir;
  }

  const cloneCmd = `git clone --depth 50 ${cloneUrl} ${projectDir}`;
  const res = await execInContainer(containerName, cloneCmd);
  if (res.exitCode !== 0) {
    throw new Error(`git clone failed for ${project.github_repo}: ${res.stderr}`);
  }
  await execInContainer(
    containerName,
    `git remote set-url origin https://github.com/${project.github_repo}.git`,
    { workDir: projectDir },
  );
  await writeProjectGitIdentity(containerName, projectDir, project);
  return projectDir;
}

async function writeProjectGitIdentity(containerName, projectDir, project) {
  // Always write the effective identity (project override OR platform default)
  // into the repo's local .git/config so the developer can't accidentally
  // commit as themselves via the terminal.
  const { name, email } = effectiveCommitIdentity(project);
  const res = await execInContainer(
    containerName,
    `git config user.name ${JSON.stringify(name)} && git config user.email ${JSON.stringify(email)}`,
    { workDir: projectDir },
  );
  if (res.exitCode !== 0) {
    console.warn(`[docker] failed to write project git identity for ${project.slug}:`, res.stderr);
  }
}

// Create or switch to the task branch for a project inside the container.
export async function checkoutTaskBranch({ containerName, project, branchName }) {
  const projectDir = await ensureProjectClonedInContainer(containerName, project);

  const cmd = `
    set -e
    git fetch origin
    git checkout ${project.default_branch}
    git pull --ff-only
    if git rev-parse --verify --quiet "${branchName}" >/dev/null; then
      git checkout "${branchName}"
    else
      git checkout -b "${branchName}"
    fi
  `;
  const res = await execInContainer(containerName, cmd, { workDir: projectDir });
  if (res.exitCode !== 0) {
    throw new Error(`branch checkout failed: ${res.stderr || res.stdout}`);
  }
  return projectDir;
}

// Commit any local changes and push to origin using the platform's GitHub token.
// The commit author is always forced to the effective identity (project override
// OR platform default) via `-c user.name=... -c user.email=...` so it's correct
// even if the local config in the workspace drifted.
export async function commitAndPush({ containerName, project, branchName, commitMessage }) {
  const projectDir = `/home/coder/projects/${project.slug}`;
  const cloneUrl = authenticatedCloneUrl(project.github_repo, tokenForProject(project));

  const { name, email } = effectiveCommitIdentity(project);
  const identityFlags = `-c user.name=${JSON.stringify(name)} -c user.email=${JSON.stringify(email)}`;

  // Use a one-shot push URL so the token never sits in the repo's git config.
  const cmd = `
    set -e
    git add -A
    if git diff --cached --quiet; then
      echo "no changes to commit"
    else
      git ${identityFlags} commit -m ${JSON.stringify(commitMessage)}
    fi
    git push ${cloneUrl} HEAD:${branchName}
  `;
  const res = await execInContainer(containerName, cmd, { workDir: projectDir });
  if (res.exitCode !== 0) {
    throw new Error(`commit/push failed: ${res.stderr || res.stdout}`);
  }
  return res.stdout;
}
