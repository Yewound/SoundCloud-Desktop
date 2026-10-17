const HELP_SITE = 'https://docs.getsoundcloud.app';

export function helpUrl(page: string, language: string): string {
  return language.startsWith('ru') ? `${HELP_SITE}/${page}` : `${HELP_SITE}/en/${page}`;
}
