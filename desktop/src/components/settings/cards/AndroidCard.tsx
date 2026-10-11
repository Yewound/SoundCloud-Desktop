import { openUrl } from '@tauri-apps/plugin-opener';
import { useTranslation } from 'react-i18next';
import { ANDROID_CLIENT_RELEASES_URL, ANDROID_CLIENT_URL } from '../../../lib/constants';
import { Download, ExternalLink, Smartphone } from '../../../lib/icons';
import { LinkOption } from '../LinkOption';
import { Card } from '../primitives';

export function AndroidCard() {
  const { t } = useTranslation();

  return (
    <Card
      title={t('settings.android')}
      desc={t('settings.androidDesc')}
      icon={<Smartphone size={17} />}
      action={
        <span className="shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-emerald-300/75 bg-emerald-400/[0.08] border border-emerald-400/[0.18]">
          {t('settings.androidOfficial')}
        </span>
      }
    >
      <div className="grid gap-2.5 sm:grid-cols-2">
        <LinkOption
          icon={<Download size={17} />}
          title={t('settings.androidDownload')}
          desc={t('settings.androidDownloadDesc')}
          trailing={<ExternalLink size={14} />}
          onClick={() => openUrl(ANDROID_CLIENT_RELEASES_URL)}
        />
        <LinkOption
          icon={<ExternalLink size={17} />}
          title={t('settings.androidSource')}
          desc={t('settings.androidSourceDesc')}
          trailing={<ExternalLink size={14} />}
          onClick={() => openUrl(ANDROID_CLIENT_URL)}
        />
      </div>
      <p className="mt-3.5 text-[11.5px] text-white/35 leading-snug">{t('settings.androidNote')}</p>
      <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-2.5">
        <div className="flex items-center gap-2.5 text-[12.5px] text-white/55">
          <Smartphone size={15} className="text-white/35" />
          {t('settings.ios')}
        </div>
        <span className="shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-white/40 bg-white/[0.05] border border-white/[0.08]">
          {t('settings.iosDev')}
        </span>
      </div>
    </Card>
  );
}
