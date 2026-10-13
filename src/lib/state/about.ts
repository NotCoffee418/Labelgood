// Help menu: project links, checking GitHub for a newer release, and version info
import { getVersion } from '@tauri-apps/api/app';
import { message } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { status } from './status.svelte';

const REPO_URL = 'https://github.com/NotCoffee418/Labelgood';
const LATEST_RELEASE_API = 'https://api.github.com/repos/NotCoffee418/Labelgood/releases/latest';

export const LINKS = {
  repo: REPO_URL,
  newIssue: `${REPO_URL}/issues/new/choose`,
  supportedPrinters: `${REPO_URL}/blob/main/SUPPORTED_DEVICES.md`,
};

// Opens a web page in the system browser
export function openLink(url: string) {
  openUrl(url).catch(error => status.message = { text: `Couldn't open ${url}: ${error}`, error: true });
}

// Whether version `a` (e.g. "v1.10.0" or "1.10.0") is newer than `b`
function isNewer(a: string, b: string): boolean {
  const parts = (version: string) => version.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const [pa, pb] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff > 0;
  }
  return false;
}

export async function checkForUpdates() {
  const title = 'Check for Updates';
  const current = await getVersion();
  let release: { tag_name: string; html_url: string };
  try {
    const response = await fetch(LATEST_RELEASE_API, { headers: { Accept: 'application/vnd.github+json' } });
    if (response.status === 404) {
      await message(`No releases have been published yet. You have version ${current}.`, { title });
      return;
    }
    if (!response.ok) throw new Error(`GitHub answered with ${response.status} ${response.statusText}`);
    release = await response.json();
  } catch (error) {
    await message(`Couldn't check for updates: ${error instanceof Error ? error.message : error}`, { title, kind: 'error' });
    return;
  }

  const latest = release.tag_name.replace(/^v/, '');
  if (!isNewer(latest, current)) {
    await message(`You have the latest version (${current}).`, { title });
    return;
  }
  const answer = await message(`Labelgood ${latest} is available. You have ${current}.`, {
    title: 'Update Available',
    buttons: { ok: 'Download', cancel: 'Later' },
  });
  if (answer === 'Download' || answer === 'Ok') openLink(release.html_url);
}

export async function showAbout() {
  const version = await getVersion();
  await message(`Labelgood ${version}\nLabel editor and printer\n\n© Stijn Raeymaekers · MIT License\n${REPO_URL}`, {
    title: 'About Labelgood',
  });
}
