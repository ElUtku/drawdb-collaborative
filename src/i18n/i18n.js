import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { en } from "./locales/en";
import { languages } from "./languages";

export { languages };

// The 50+ translation files add up to half a megabyte, so only English is
// bundled with the app shell and the rest are fetched when they are selected.
const localeModules = import.meta.glob("./locales/*.js");
const fileByCode = new Map(languages.map((l) => [l.code, l.file]));

const lazyLocales = {
  type: "backend",
  init: () => {},
  read(language, namespace, callback) {
    const file = fileByCode.get(language);
    const load = file && localeModules[`./locales/${file}.js`];
    if (!load) {
      // Region variants such as "ru-RU" land here; i18next falls back to the
      // base language on its own.
      callback(null, false);
      return;
    }
    load()
      .then((module) => {
        const bundle = Object.values(module).find(
          (value) => value?.translation,
        );
        callback(null, bundle?.[namespace] ?? false);
      })
      .catch((error) => callback(error, false));
  },
};

export const i18nReady = i18n
  .use(lazyLocales)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: "en",
    debug: false,
    partialBundledLanguages: true,
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
    resources: { en },
  });

export default i18n;
