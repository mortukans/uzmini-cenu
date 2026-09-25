/**
 * Riga district canonical table (docs/03 "Riga district canonicalisation").
 * Key = SS URL slug. `lv` is what `listings.location` stores.
 */
export interface District {
  slug: string;
  lv: string;
  ru: string;
}

export const RIGA_DISTRICTS: District[] = [
  { slug: 'centre', lv: 'Centrs', ru: 'Центр' },
  { slug: 'vecriga', lv: 'Vecrīga', ru: 'Старая Рига' },
  { slug: 'agenskalns', lv: 'Āgenskalns', ru: 'Агенскалнс' },
  { slug: 'aplokciems', lv: 'Aplokciems', ru: 'Аплокциемс' },
  { slug: 'bergi', lv: 'Berģi', ru: 'Берги' },
  { slug: 'biekensala', lv: 'Bieķēnsala', ru: 'Биекенсала' },
  { slug: 'bierini', lv: 'Bieriņi', ru: 'Биерини' },
  { slug: 'bolderaya', lv: 'Bolderāja', ru: 'Болдерая' },
  { slug: 'breksi', lv: 'Brekši', ru: 'Брекши' },
  { slug: 'bukulti', lv: 'Bukulti', ru: 'Букулты' },
  { slug: 'chiekurkalns', lv: 'Čiekurkalns', ru: 'Чиекуркалнс' },
  { slug: 'darzciems', lv: 'Dārzciems', ru: 'Дарзциемс' },
  { slug: 'daugavgriva', lv: 'Daugavgrīva', ru: 'Даугавгрива' },
  { slug: 'dreilini', lv: 'Dreiliņi', ru: 'Дрейлини' },
  { slug: 'dzeguzhkalns', lv: 'Dzegužkalns (Dzirciems)', ru: 'Дзегужкалнс (Дзирциемс)' },
  { slug: 'grizinkalns', lv: 'Grīziņkalns', ru: 'Гризинькалнс' },
  { slug: 'ilguciems', lv: 'Iļģuciems', ru: 'Ильгюциемс' },
  { slug: 'imanta', lv: 'Imanta', ru: 'Иманта' },
  { slug: 'zolitude', lv: 'Zolitūde', ru: 'Золитуде' },
  { slug: 'janjavarti', lv: 'Jāņavārti', ru: 'Яняварты' },
  { slug: 'katlakalns', lv: 'Katlakalns', ru: 'Катлакалнс' },
  { slug: 'kipsala', lv: 'Ķīpsala', ru: 'Кипсала' },
  { slug: 'kleisti', lv: 'Kleisti', ru: 'Клейсты' },
  { slug: 'kliversala', lv: 'Klīversala', ru: 'Кливерсала' },
  { slug: 'lucavsala', lv: 'Lucavsala', ru: 'Луцавсала' },
  { slug: 'kengarags', lv: 'Ķengarags', ru: 'Кенгарагс' },
  { slug: 'plyavnieki', lv: 'Pļavnieki', ru: 'Плявниеки' },
  { slug: 'purvciems', lv: 'Purvciems', ru: 'Пурвциемс' },
  { slug: 'mezhciems', lv: 'Mežciems', ru: 'Межциемс' },
  { slug: 'mezhapark', lv: 'Mežaparks', ru: 'Межапарк' },
  { slug: 'teika', lv: 'Teika', ru: 'Тейка' },
  { slug: 'vef', lv: 'VEF', ru: 'ВЭФ' },
  { slug: 'yugla', lv: 'Jugla', ru: 'Югла' },
  { slug: 'jaunciems', lv: 'Jaunciems', ru: 'Яунциемс' },
  { slug: 'jaunmilgravis', lv: 'Jaunmīlgrāvis', ru: 'Яунмилгравис' },
  { slug: 'vecmilgravis', lv: 'Vecmīlgrāvis', ru: 'Вецмилгравис' },
  { slug: 'mangali', lv: 'Mangaļi', ru: 'Мангали' },
  { slug: 'mangalsala', lv: 'Mangaļsala', ru: 'Мангальсала' },
  { slug: 'vecaki', lv: 'Vecāķi', ru: 'Вецаки' },
  { slug: 'vecdaugava', lv: 'Vecdaugava', ru: 'Вецдаугава' },
  { slug: 'sarkandaugava', lv: 'Sarkandaugava', ru: 'Саркандаугава' },
  { slug: 'kundzinsala', lv: 'Kundziņsala', ru: 'Кундзиньсала' },
  { slug: 'maskavas-priekshpilseta', lv: 'Latgales priekšpilsēta (Maskačka)', ru: 'Латгальское предместье (Маскачка)' },
  { slug: 'krasta-st-area', lv: 'Krasta rajons', ru: 'Район ул. Краста' },
  { slug: 'shkirotava', lv: 'Šķirotava', ru: 'Шкиротава' },
  { slug: 'zasulauks', lv: 'Zasulauks', ru: 'Засулаукс' },
  { slug: 'shampeteris-pleskodale', lv: 'Šampēteris-Pleskodāle', ru: 'Шампетерис-Плескодале' },
  { slug: 'tornjakalns', lv: 'Torņakalns', ru: 'Торнякалнс' },
  { slug: 'ziepniekkalns', lv: 'Ziepniekkalns', ru: 'Зиепниеккалнс' },
  { slug: 'zakusala', lv: 'Zaķusala', ru: 'Закюсала' },
  { slug: 'other', lv: 'Cits rajons', ru: 'Другой район' },
];

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zа-я0-9]+/g, '');

const BY_SLUG = new Map(RIGA_DISTRICTS.map((d) => [d.slug, d]));
const BY_NAME = new Map<string, District>();
for (const d of RIGA_DISTRICTS) {
  BY_NAME.set(fold(d.lv), d);
  BY_NAME.set(fold(d.ru), d);
  // "Dzegužkalns (Dzirciems)" also matches either half; "Latgales priekšpilsēta (Maskačka)" → "Maskačka"
  const m = d.lv.match(/^(.*?)\s*\((.*)\)$/);
  if (m) {
    BY_NAME.set(fold(m[1]!), d);
    BY_NAME.set(fold(m[2]!), d);
  }
  const r = d.ru.match(/^(.*?)\s*\((.*)\)$/);
  if (r) {
    BY_NAME.set(fold(r[1]!), d);
    BY_NAME.set(fold(r[2]!), d);
  }
}
// SS shows a few names slightly differently from our table
BY_NAME.set(fold('Centrs'), BY_SLUG.get('centre')!);
BY_NAME.set(fold('Maskavas priekšpilsēta'), BY_SLUG.get('maskavas-priekshpilseta')!);
BY_NAME.set(fold('Maskavas forštate'), BY_SLUG.get('maskavas-priekshpilseta')!);
BY_NAME.set(fold('Krasta r-ns'), BY_SLUG.get('krasta-st-area')!);
BY_NAME.set(fold('Dzirciems'), BY_SLUG.get('dzeguzhkalns')!);
BY_NAME.set(fold('Šampēteris'), BY_SLUG.get('shampeteris-pleskodale')!);
BY_NAME.set(fold('Pleskodāle'), BY_SLUG.get('shampeteris-pleskodale')!);
BY_NAME.set(fold('Cits'), BY_SLUG.get('other')!);

export const districtBySlug = (slug: string): District | undefined => BY_SLUG.get(slug.toLowerCase());
export const districtByName = (name: string): District | undefined => BY_NAME.get(fold(name));

/** Slug from a `/lv/real-estate/flats/riga/{slug}/` or `/msg/lv/real-estate/flats/riga/{slug}/id.html` URL. */
export function districtFromUrl(url: string): District | undefined {
  const m = url.match(/\/real-estate\/[a-z-]+\/riga\/([a-z-]+)\//);
  return m ? districtBySlug(m[1]!) : undefined;
}
