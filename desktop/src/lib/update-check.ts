import i18n from '../i18n';
import { APP_VERSION, GITHUB_OWNER, GITHUB_REPO, GITHUB_REPO_EN } from './constants';
import { netFetch } from './net/fetch';
import { isNewerVersion } from './semver';
import { mirroredUrl } from './update-assets';

const DIRECT_TIMEOUT_MS = 8_000;

export interface GithubAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

export interface GithubRelease {
  tag_name: string;
  name: string;
  body: string;
  html_url: string;
  published_at: string;
  assets: GithubAsset[];
}

function stripLeadingV(version: string) {
  return version.replace(/^v/, '');
}

async function fetchJson(url: string, timeoutMs?: number): Promise<GithubRelease | null> {
  const response = await netFetch(url, { timeoutMs });
  return response.ok ? response.json() : null;
}

async function fetchRelease(repo: string): Promise<GithubRelease | null> {
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${repo}/releases/latest`;
  const direct = await fetchJson(url, DIRECT_TIMEOUT_MS).catch(() => null);
  return direct ?? fetchJson(mirroredUrl(url));
}

export async function checkForAppUpdate(): Promise<GithubRelease | null> {
  const primaryRelease = await fetchRelease(GITHUB_REPO);
  if (!primaryRelease) throw new Error('latest release is unavailable');

  const latest = stripLeadingV(primaryRelease.tag_name);
  const current = stripLeadingV(APP_VERSION);
  if (!isNewerVersion(latest, current)) return null;

  const prefersEnglishRelease = !i18n.language?.startsWith('ru');
  if (prefersEnglishRelease) {
    const englishRelease = await fetchRelease(GITHUB_REPO_EN).catch(() => null);
    if (englishRelease && stripLeadingV(englishRelease.tag_name) === latest) {
      return { ...englishRelease, assets: primaryRelease.assets };
    }
  }

  return primaryRelease;
}
