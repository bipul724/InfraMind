// The accessible name of a Saved Files row button. Two saved files can share a name (two
// Dockerfiles), so the name says which repository the file came from when its URL is one
// the GitHub parser accepts: "Download Dockerfile from owner/repo". Relative imports only,
// so `node --test` loads this file directly.
import { parseGitHubRepoUrl } from './githubUrl.ts';

export function savedFileLabel(action: 'Download' | 'Delete', name: string, repoUrl?: string | null): string {
  const repo = parseGitHubRepoUrl(repoUrl);
  return repo ? `${action} ${name} from ${repo.owner}/${repo.repo}` : `${action} ${name}`;
}
