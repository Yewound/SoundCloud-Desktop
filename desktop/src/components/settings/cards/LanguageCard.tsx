import {openUrl} from '@tauri-apps/plugin-opener';
import {useTranslation} from 'react-i18next';
import {changeAppLanguage} from '../../../i18n';
import {REQUEST_LANGUAGE_URL} from '../../../lib/constants';
import {ExternalLink, Globe} from '../../../lib/icons';
import {Card} from '../primitives';

const LANGUAGES = [
    {code: 'en', label: 'English'},
    {code: 'ru', label: 'Русский'},
    {code: 'tr', label: 'Turkce'},
    {code: 'ko', label: '한국어'},
] as const;

export function LanguageCard() {
    const {t, i18n} = useTranslation();
    return (
        <Card title={t('settings.language')} icon={<Globe size={17}/>}>
            <div className="flex flex-wrap gap-2">
                {LANGUAGES.map((lang) => {
                    const active = i18n.language === lang.code;
                    return (
                        <button
                            key={lang.code}
                            type="button"
                            onClick={() => void changeAppLanguage(lang.code)}
                            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold transition-all duration-200 cursor-pointer border ${
                                active
                                    ? 'bg-white/[0.1] text-white/90 border-white/[0.15]'
                                    : 'bg-white/[0.02] text-white/45 border-white/[0.05] hover:bg-white/[0.06] hover:text-white/60'
                            }`}
                        >
                            <Globe size={14} strokeWidth={1.8}/>
                            {lang.label}
                        </button>
                    );
                })}
            </div>
            <button
                type="button"
                onClick={() => void openUrl(REQUEST_LANGUAGE_URL)}
                className="mt-3.5 inline-flex items-center gap-1.5 text-[11.5px] text-white/35 hover:text-white/70 transition-colors cursor-pointer"
            >
                <ExternalLink size={12} strokeWidth={1.8}/>
                {t('settings.languageRequest')}
            </button>
        </Card>
    );
}
