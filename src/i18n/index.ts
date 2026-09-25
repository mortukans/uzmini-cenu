import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { getLocales } from 'expo-localization';
import type { Lang } from '../api/types';

// Namespaces: `common` (core game, owned by the game screens) and `social`
// (friends, duels, rooms). Add new namespaces as separate files to avoid
// merge conflicts.
import lvCommon from './lv/common.json';
import ruCommon from './ru/common.json';
import enCommon from './en/common.json';
import lvSocial from './lv/social.json';
import ruSocial from './ru/social.json';
import enSocial from './en/social.json';

export const SUPPORTED: Lang[] = ['lv', 'ru', 'en'];

export function deviceLang(): Lang {
  const code = getLocales()[0]?.languageCode ?? 'lv';
  return (SUPPORTED as string[]).includes(code) ? (code as Lang) : 'lv';
}

void i18n.use(initReactI18next).init({
  resources: {
    lv: { common: lvCommon, social: lvSocial },
    ru: { common: ruCommon, social: ruSocial },
    en: { common: enCommon, social: enSocial },
  },
  lng: deviceLang(),
  fallbackLng: 'lv',
  defaultNS: 'common',
  ns: ['common', 'social'],
  interpolation: { escapeValue: false },
  returnNull: false,
});

export const setLang = (lng: Lang) => i18n.changeLanguage(lng);
export const currentLang = (): Lang => (i18n.language?.slice(0, 2) as Lang) ?? 'lv';
export default i18n;
