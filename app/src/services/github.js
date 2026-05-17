import { Octokit } from 'octokit';

const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) {
  console.warn('[github] GITHUB_TOKEN not set — branch/PR queries will fail.');
}

export const octokit = new Octokit({ auth: TOKEN });

export function parseRepo(repo) {
  const [owner, name] = String(repo || '').split('/');
  if (!owner || !name) throw new Error(`invalid github_repo "${repo}", expected "owner/name"`);
  return { owner, name };
}

export async function branchExists(repo, branch) {
  const { owner, name } = parseRepo(repo);
  try {
    await octokit.rest.repos.getBranch({ owner, repo: name, branch });
    return true;
  } catch (err) {
    if (err.status === 404) return false;
    throw err;
  }
}

export async function findOpenPrForBranch(repo, branch) {
  const { owner, name } = parseRepo(repo);
  const { data } = await octokit.rest.pulls.list({
    owner,
    repo: name,
    head: `${owner}:${branch}`,
    state: 'all',
    per_page: 1,
  });
  return data[0] || null;
}

// Builds the HTTPS clone URL with the platform's PAT embedded.
// Used only when cloning *into* a developer container.
export function authenticatedCloneUrl(repo) {
  const { owner, name } = parseRepo(repo);
  // PAT goes as the username; "x-oauth-basic" is a conventional placeholder password.
  return `https://${TOKEN}:x-oauth-basic@github.com/${owner}/${name}.git`;
}

export function publicRepoUrl(repo) {
  const { owner, name } = parseRepo(repo);
  return `https://github.com/${owner}/${name}`;
}
