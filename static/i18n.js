'use strict'
/* BabyLog translations. English text is the key; ru/hu map it to their language.
   t('Last feed: {side} at {time}', {side, time}) fills {placeholders}.
   A missing translation falls back to English. Add a language: add it to LANGS and DICT. */

const LANGS = { en: 'English', ru: 'Русский', hu: 'Magyar' }
const LOCALES = { en: 'en-GB', ru: 'ru-RU', hu: 'hu-HU' }

function detectLang() {
  try {
    const saved = localStorage.getItem('babylog-lang')
    if (saved && LANGS[saved]) return saved
  } catch {}
  const nav = (navigator.languages || [navigator.language || 'en']).map((l) => String(l).slice(0, 2).toLowerCase())
  return nav.find((l) => LANGS[l]) || 'en'
}
let LANG = detectLang()
let LOCALE = LOCALES[LANG]
function setLang(l) {
  if (!LANGS[l]) return
  LANG = l
  LOCALE = LOCALES[l]
  try { localStorage.setItem('babylog-lang', l) } catch {}
  // the sign-in page (rendered by the server) follows the same choice
  document.cookie = 'babylog_lang=' + l + '; path=/; max-age=31536000; samesite=strict'
  document.documentElement.lang = l
}
document.documentElement.lang = LANG

function t(s, vars) {
  const d = DICT[LANG]
  let out = (d && d[s]) || s
  if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m))
  return out
}

// Plurals: pick the right word form for n.
//   en: [one, other]   hu: [one, other]   ru: [one, few, many]
function plural(n, forms) {
  const f = forms[LANG] || forms.en
  if (LANG === 'ru') {
    const a = Math.abs(n) % 100, b = a % 10
    if (a > 10 && a < 20) return f[2]
    if (b === 1) return f[0]
    if (b >= 2 && b <= 4) return f[1]
    return f[2]
  }
  return n === 1 ? f[0] : f[1]
}
const P = {
  week: { en: ['week', 'weeks'], ru: ['неделя', 'недели', 'недель'], hu: ['hét', 'hét'] },
  day: { en: ['day', 'days'], ru: ['день', 'дня', 'дней'], hu: ['nap', 'nap'] },
  hour: { en: ['hour', 'hours'], ru: ['час', 'часа', 'часов'], hu: ['óra', 'óra'] },
  month: { en: ['month', 'months'], ru: ['месяц', 'месяца', 'месяцев'], hu: ['hónap', 'hónap'] },
  feed: { en: ['feed', 'feeds'], ru: ['кормление', 'кормления', 'кормлений'], hu: ['etetés', 'etetés'] },
  entry: { en: ['entry', 'entries'], ru: ['запись', 'записи', 'записей'], hu: ['bejegyzés', 'bejegyzés'] },
  file: { en: ['file', 'files'], ru: ['файл', 'файла', 'файлов'], hu: ['fájl', 'fájl'] },
}
const pl = (n, key) => `${n} ${plural(n, P[key])}`

// Short duration units: 1h 20m / 1 ч 20 мин / 1 ó 20 p
const UNIT = {
  en: { h: 'h', m: 'm' },
  ru: { h: ' ч', m: ' мин' },
  hu: { h: 'ó', m: 'p' },
}
const uh = () => (UNIT[LANG] || UNIT.en).h
const um = () => (UNIT[LANG] || UNIT.en).m

// "6 weeks, 4 days old" / "6 недель и 4 дня" / "6 hetes és 4 napos"
function ageWords(days, hours, withOld) {
  if (days < 1) {
    if (hours <= 1) return t('newborn')
    return LANG === 'hu' ? `${hours} órás` : withOld ? t('{n} old', { n: pl(hours, 'hour') }) : pl(hours, 'hour')
  }
  const w = Math.floor(days / 7), rd = days % 7
  if (LANG === 'hu') {
    const parts = []
    if (w > 0) parts.push(`${w} hetes`)
    if (rd > 0 || !w) parts.push(`${rd} napos`)
    return parts.join(' és ')
  }
  const parts = []
  if (w > 0) parts.push(pl(w, 'week'))
  parts.push(pl(rd, 'day'))
  const s = LANG === 'ru' ? parts.join(' и ') : parts.join(', ')
  return withOld ? t('{n} old', { n: s }) : s
}

const DICT = {
  ru: {
    // general
    'Loading…': 'Загрузка…', 'Could not reach the server.': 'Не удаётся связаться с сервером.',
    'Something went wrong: {msg}': 'Что-то пошло не так: {msg}', 'too many requests — slow down': 'слишком много запросов — помедленнее',
    'Edit': 'Изменить', 'Delete': 'Удалить', 'Close': 'Закрыть', 'Cancel': 'Отмена', 'Save': 'Сохранить', 'OK': 'OK',
    'Yes': 'Да', 'No': 'Нет', 'Previous': 'Назад', 'Next': 'Вперёд', 'Remove': 'Убрать',
    'Home': 'Главная', 'Calendar': 'Календарь', 'Stats': 'Статистика', 'Moments': 'Моменты', 'Baby': 'Малыш',
    'Entries': 'Записи', 'newborn': 'новорождённый', '{n} old': '{n}', 'not born yet': 'ещё не родился(ась)',
    'left': 'слева', 'right': 'справа', 'back': 'на спине', 'both': 'обе',
    'L+R': 'Л+П', 'L': 'Л', 'R': 'П',
    // onboarding
    'Welcome to BabyLog': 'Добро пожаловать в BabyLog', 'Add your baby to start tracking feeds, sleep and more.': 'Добавьте малыша, чтобы записывать кормления, сон и многое другое.',
    // event labels
    'Breastfed {side} · {dur}': 'Грудь {side} · {dur}', 'Bottle · {ml} ml': 'Бутылочка · {ml} мл', 'Slept · {dur}': 'Сон · {dur}',
    'Pee': 'Пописали', 'Poo': 'Покакали', 'Temp · {v}': 'Темп. · {v}', 'Weight · {v}': 'Вес · {v}', 'Length · {v}': 'Рост · {v}', 'Bath': 'Купание',
    'Milestone': 'Момент',
    // home
    'last used': 'последняя', 'tap to stop': 'нажмите, чтобы остановить', 'tap to start': 'нажмите, чтобы начать',
    'Last feed: {side} at {time} · {ago} ago': 'Последнее кормление: {side} в {time} · {ago} назад',
    'Last slept: {side}at {time} · woke {woke} · awake {awake}': 'Последний сон: {side}в {time} · проснулись в {woke} · не спит {awake}',
    '{ago} ago · {n} today': '{ago} назад · {n} сегодня', 'Bath due today': 'Сегодня купание', 'Next bath {date}': 'Следующее купание {date}',
    'Last weight': 'Последний вес', 'Last pee': 'Пописали', 'Last poo': 'Покакали', 'Last length': 'Последний рост',
    'Bath done': 'Искупали', "Today's medicine": 'Лекарства на сегодня', 'Give': 'Дать',
    'Breastfeeding': 'Грудное вскармливание', 'Left': 'Левая', 'Right': 'Правая', 'Sleep': 'Сон', 'Stop': 'Стоп', 'Start': 'Старт',
    'Sleeping position': 'Положение во сне', 'On back': 'На спине', 'Quick check-in': 'Быстрая отметка',
    'Bottle': 'Бутылочка', 'Temp': 'Темп.', 'Weight': 'Вес', 'Length': 'Рост', 'Note': 'Заметка', 'Medicine': 'Лекарство',
    "Today's log": 'Записи за сегодня', 'Nothing logged yet today.': 'Сегодня пока ничего не записано.',
    // calendar
    'Month': 'Месяц', 'Day': 'День', 'No entries for this day.': 'За этот день записей нет.', 'Session {n}': 'Эпизод {n}',
    'Feeds': 'Кормления', 'Pee · Poo': 'Пописали · Покакали', 'Tap a card to view, edit or delete its entries.': 'Нажмите на карточку, чтобы посмотреть, изменить или удалить записи.',
    '{a} after midnight · {b} total': '{a} после полуночи · всего {b}', 'Slept {dur}': 'Сон {dur}', 'Sleep · from yesterday': 'Сон · со вчера',
    'Breast': 'Грудь', 'Pee ×{n}': 'Пописали ×{n}', 'Poo ×{n}': 'Покакали ×{n}',
    'Mon': 'Пн', 'Tue': 'Вт', 'Wed': 'Ср', 'Thu': 'Чт', 'Fri': 'Пт', 'Sat': 'Сб', 'Sun': 'Вс',
    // stats
    'Night': 'Ночь', 'Morning': 'Утро', 'Midday': 'День', 'Evening': 'Вечер',
    '{h}:00–{h2}:00 · asleep {m} min/day': '{h}:00–{h2}:00 · сна {m} мин/день',
    'Total gain': 'Всего прибавил', 'Per day': 'В день', 'Latest': 'Последний', 'Total growth': 'Всего вырос',
    '{date} · {feeds}': '{date} · {feeds}', 'avg {v}': 'в ср. {v}', '{h}:00 · {feeds}': '{h}:00 · {feeds}',
    '{n}d': '{n} дн.', 'Feeds / day': 'Кормлений в день', 'Sleep / day': 'Сна в день', 'Feed interval': 'Интервал кормлений', 'Feed length': 'Длительность кормления',
    'Feeds per day': 'Кормлений по дням', 'Add at least two weights to see the trend.': 'Добавьте хотя бы два взвешивания, чтобы увидеть динамику.',
    'Add at least two lengths to see the trend.': 'Добавьте хотя бы два измерения роста, чтобы увидеть динамику.',
    'Feeding': 'Кормление', 'Left {n}': 'Левая {n}', 'Right {n}': 'Правая {n}', 'Bottle / day': 'Бутылочка в день',
    'Longest stretch': 'Самый долгий сон', 'Sleeps / day': 'Снов в день', 'Night {p}%': 'Ночь {p}%', 'Day {p}%': 'День {p}%',
    'Sleep by time of day': 'Сон по времени суток', 'No sleep logged in this period.': 'За этот период сон не записан.',
    'Mostly sleeps in the <b>{frame}</b> · {dur} a day on average': 'Больше всего спит <b>{frame}</b> · в среднем {dur} в день',
    'in the night': 'ночью', 'in the morning': 'утром', 'in the midday': 'днём', 'in the evening': 'вечером',
    'Most asleep {a}:00–{b}:00 · {m} of 60 min on average': 'Чаще всего спит {a}:00–{b}:00 · в среднем {m} из 60 мин',
    'Diapers': 'Подгузники', 'Pee / day': 'Пописали в день', 'Poo / day': 'Покакали в день', 'Feeding times (24h)': 'Время кормлений (24 ч)',
    '{label} over time': '{label}: динамика',
    // milestones
    'First smile': 'Первая улыбка', 'Lifted head': 'Держит голову', 'First laugh': 'Первый смех', 'Rolled over': 'Переворачивается',
    'Sat up': 'Сидит', 'First tooth': 'Первый зуб', 'Crawled': 'Ползает', 'First word': 'Первое слово', 'First steps': 'Первые шаги', 'First bath': 'Первое купание',
    'Newborn': 'Новорождённый', 'Born': 'Рождение', 'next stop · tap to add': 'следующий шаг · нажмите, чтобы добавить',
    "{name}'s journey": 'Путь: {name}', 'Add milestone': 'Добавить момент', 'Edit milestone': 'Изменить момент',
    'Title': 'Название', 'e.g. First smile': 'напр. Первая улыбка', 'Note (optional)': 'Заметка (необязательно)', 'what happened': 'что случилось',
    'Photos (optional)': 'Фото (необязательно)', 'Add photos': 'Добавить фото',
    'Up to {n} photos per milestone.': 'Не больше {n} фото на момент.', 'Preparing {k} of {n}…': 'Подготовка {k} из {n}…',
    'Could not read "{name}".': 'Не удалось прочитать «{name}».', '{files} skipped — only photos can be added.': 'Пропущено: {files} — можно добавлять только фото.',
    'Enter a title': 'Введите название', 'Uploading {k} of {n}…': 'Загрузка {k} из {n}…', 'Saving…': 'Сохранение…', 'Upload failed: {msg}': 'Ошибка загрузки: {msg}',
    // settings
    'Girl · pink theme': 'Девочка · розовая тема', 'Boy · blue theme': 'Мальчик · голубая тема', 'Born {date}': 'Дата рождения: {date}',
    'Edit baby': 'Изменить данные малыша', 'Add another baby': 'Добавить ещё малыша', 'Medicines': 'Лекарства', 'No medicines yet.': 'Лекарств пока нет.',
    '{n}× a day': '{n}× в день', 'As needed': 'По необходимости', 'Add medicine': 'Добавить лекарство',
    'Night mode': 'Ночной режим', 'Auto 21–07': 'Авто 21–07', 'Always': 'Всегда', 'Off': 'Выкл.',
    'Dim, warm colours for night feeds. Auto switches on between 21:00 and 07:00 (this device).': 'Тёмные тёплые цвета для ночных кормлений. «Авто» включает их с 21:00 до 07:00 (на этом устройстве).',
    'Language': 'Язык', 'Backup': 'Резервная копия',
    'Your data lives on the server and is shared across devices. Export a JSON copy any time.': 'Данные хранятся на сервере и общие для всех устройств. Копию в JSON можно выгрузить в любой момент.',
    'Export data': 'Выгрузить данные', 'Log out': 'Выйти', 'Delete this baby': 'Удалить этого малыша',
    // check-in
    'baby': 'малыш', 'Check-in · {name}': 'Отметка · {name}', 'Did {name} pee?': '{name} пописал(а)?', 'Did {name} poo?': '{name} покакал(а)?',
    'Temperature (°C) — optional': 'Температура (°C) — необязательно',
    // log sheet
    'bottle feed': 'кормление из бутылочки', 'temperature': 'температуру', 'weight': 'вес', 'length': 'рост', 'note': 'заметку', 'breastfeed': 'кормление грудью',
    'pee': 'пописали', 'poo': 'покакали', 'sleep': 'сон', 'Edit {what}': 'Изменить: {what}', 'Add {what}': 'Добавить: {what}',
    'Amount (ml)': 'Объём (мл)', 'Side': 'Сторона', 'Both': 'Обе', 'Position': 'Положение',
    'Temperature (°C)': 'Температура (°C)', 'Weight (kg)': 'Вес (кг)', 'Length (cm)': 'Рост (см)',
    'Date': 'Дата', 'Time': 'Время', 'Duration': 'Длительность', 'End time': 'Время окончания', 'Minutes': 'Минуты', 'Ends at': 'Закончилось в',
    'No medicines yet. Add them in the Baby tab under "Medicines" first.': 'Лекарств пока нет. Сначала добавьте их во вкладке «Малыш» в разделе «Лекарства».',
    'Edit medicine': 'Изменить лекарство', 'Log medicine': 'Записать лекарство', 'Dose / note (optional)': 'Доза / заметка (необязательно)', 'e.g. 2.5 ml': 'напр. 2,5 мл',
    'Name': 'Имя', 'e.g. Vitamin D': 'напр. Витамин D', 'Times per day': 'Раз в день', 'Description (optional)': 'Описание (необязательно)',
    'dose, when to give, notes': 'доза, когда давать, заметки',
    // baby form
    "Baby's name": 'Имя малыша', 'Sex (sets the theme)': 'Пол (задаёт тему)', 'Girl · pink': 'Девочка · розовая', 'Boy · blue': 'Мальчик · голубая',
    'Date of birth': 'Дата рождения', 'Save baby': 'Сохранить', 'Add baby': 'Добавить малыша',
    'Enter a name first': 'Сначала введите имя', 'Enter the date and time of birth': 'Введите дату и время рождения',
    // validation
    'Enter ml': 'Введите мл', 'Enter temperature': 'Введите температуру', 'Enter weight': 'Введите вес', 'Enter length': 'Введите рост', 'Enter a note': 'Введите заметку',
    'Enter the end time': 'Введите время окончания', 'Enter minutes': 'Введите минуты', 'Pick a medicine': 'Выберите лекарство', 'Enter a name': 'Введите название',
    // confirms
    'Delete this entry?': 'Удалить эту запись?', 'Delete these {n}?': 'Удалить {n}?', 'Delete {name} and all their data? This cannot be undone.': 'Удалить {name} и все данные? Это нельзя отменить.',
  },
  hu: {
    'Loading…': 'Betöltés…', 'Could not reach the server.': 'Nem érhető el a szerver.',
    'Something went wrong: {msg}': 'Hiba történt: {msg}', 'too many requests — slow down': 'túl sok kérés — lassabban',
    'Edit': 'Szerkesztés', 'Delete': 'Törlés', 'Close': 'Bezárás', 'Cancel': 'Mégse', 'Save': 'Mentés', 'OK': 'OK',
    'Yes': 'Igen', 'No': 'Nem', 'Previous': 'Előző', 'Next': 'Következő', 'Remove': 'Eltávolítás',
    'Home': 'Főoldal', 'Calendar': 'Naptár', 'Stats': 'Statisztika', 'Moments': 'Pillanatok', 'Baby': 'Baba',
    'Entries': 'Bejegyzések', 'newborn': 'újszülött', '{n} old': '{n}', 'not born yet': 'még nem született meg',
    'left': 'bal', 'right': 'jobb', 'back': 'háton', 'both': 'mindkettő',
    'L+R': 'B+J', 'L': 'B', 'R': 'J',
    'Welcome to BabyLog': 'Üdv a BabyLogban', 'Add your baby to start tracking feeds, sleep and more.': 'Add hozzá a babát, és máris rögzítheted az etetést, alvást és a többit.',
    'Breastfed {side} · {dur}': 'Szoptatás {side} · {dur}', 'Bottle · {ml} ml': 'Cumisüveg · {ml} ml', 'Slept · {dur}': 'Alvás · {dur}',
    'Pee': 'Pisi', 'Poo': 'Kaki', 'Temp · {v}': 'Hőmérséklet · {v}', 'Weight · {v}': 'Súly · {v}', 'Length · {v}': 'Hossz · {v}', 'Bath': 'Fürdetés',
    'Milestone': 'Mérföldkő',
    'last used': 'legutóbb', 'tap to stop': 'koppints a leállításhoz', 'tap to start': 'koppints az indításhoz',
    'Last feed: {side} at {time} · {ago} ago': 'Utolsó etetés: {side}, {time} · {ago} ezelőtt',
    'Last slept: {side}at {time} · woke {woke} · awake {awake}': 'Utolsó alvás: {side}{time} · ébredés {woke} · ébren {awake}',
    '{ago} ago · {n} today': '{ago} ezelőtt · ma {n}', 'Bath due today': 'Ma fürdetés', 'Next bath {date}': 'Következő fürdetés: {date}',
    'Last weight': 'Utolsó súly', 'Last pee': 'Utolsó pisi', 'Last poo': 'Utolsó kaki', 'Last length': 'Utolsó hossz',
    'Bath done': 'Megfürdött', "Today's medicine": 'Mai gyógyszerek', 'Give': 'Beadva',
    'Breastfeeding': 'Szoptatás', 'Left': 'Bal', 'Right': 'Jobb', 'Sleep': 'Alvás', 'Stop': 'Állj', 'Start': 'Indítás',
    'Sleeping position': 'Alvási pozíció', 'On back': 'Háton', 'Quick check-in': 'Gyors ellenőrzés',
    'Bottle': 'Cumisüveg', 'Temp': 'Hőm.', 'Weight': 'Súly', 'Length': 'Hossz', 'Note': 'Jegyzet', 'Medicine': 'Gyógyszer',
    "Today's log": 'Mai napló', 'Nothing logged yet today.': 'Ma még nincs bejegyzés.',
    'Month': 'Hónap', 'Day': 'Nap', 'No entries for this day.': 'Erre a napra nincs bejegyzés.', 'Session {n}': '{n}. alkalom',
    'Feeds': 'Etetés', 'Pee · Poo': 'Pisi · Kaki', 'Tap a card to view, edit or delete its entries.': 'Koppints egy kártyára a bejegyzések megtekintéséhez, szerkesztéséhez vagy törléséhez.',
    '{a} after midnight · {b} total': '{a} éjfél után · összesen {b}', 'Slept {dur}': 'Aludt {dur}', 'Sleep · from yesterday': 'Alvás · tegnapról',
    'Breast': 'Szoptatás', 'Pee ×{n}': 'Pisi ×{n}', 'Poo ×{n}': 'Kaki ×{n}',
    'Mon': 'H', 'Tue': 'K', 'Wed': 'Sze', 'Thu': 'Cs', 'Fri': 'P', 'Sat': 'Szo', 'Sun': 'V',
    'Night': 'Éjjel', 'Morning': 'Reggel', 'Midday': 'Nappal', 'Evening': 'Este',
    '{h}:00–{h2}:00 · asleep {m} min/day': '{h}:00–{h2}:00 · alvás {m} perc/nap',
    'Total gain': 'Összes gyarapodás', 'Per day': 'Naponta', 'Latest': 'Legutóbbi', 'Total growth': 'Összes növekedés',
    '{date} · {feeds}': '{date} · {feeds}', 'avg {v}': 'átl. {v}', '{h}:00 · {feeds}': '{h}:00 · {feeds}',
    '{n}d': '{n} nap', 'Feeds / day': 'Etetés / nap', 'Sleep / day': 'Alvás / nap', 'Feed interval': 'Etetések közti idő', 'Feed length': 'Etetés hossza',
    'Feeds per day': 'Etetések naponta', 'Add at least two weights to see the trend.': 'Adj meg legalább két súlyt a változás megjelenítéséhez.',
    'Add at least two lengths to see the trend.': 'Adj meg legalább két hosszmérést a változás megjelenítéséhez.',
    'Feeding': 'Etetés', 'Left {n}': 'Bal {n}', 'Right {n}': 'Jobb {n}', 'Bottle / day': 'Cumisüveg / nap',
    'Longest stretch': 'Leghosszabb alvás', 'Sleeps / day': 'Alvás / nap (db)', 'Night {p}%': 'Éjjel {p}%', 'Day {p}%': 'Nappal {p}%',
    'Sleep by time of day': 'Alvás napszakonként', 'No sleep logged in this period.': 'Ebben az időszakban nincs rögzített alvás.',
    'Mostly sleeps in the <b>{frame}</b> · {dur} a day on average': 'Leginkább <b>{frame}</b> alszik · átlagosan napi {dur}',
    'in the night': 'éjjel', 'in the morning': 'reggel', 'in the midday': 'napközben', 'in the evening': 'este',
    'Most asleep {a}:00–{b}:00 · {m} of 60 min on average': 'Legtöbbet {a}:00–{b}:00 alszik · átlagosan 60-ból {m} perc',
    'Diapers': 'Pelenkák', 'Pee / day': 'Pisi / nap', 'Poo / day': 'Kaki / nap', 'Feeding times (24h)': 'Etetési időpontok (24 ó)',
    '{label} over time': '{label} időben',
    'First smile': 'Első mosoly', 'Lifted head': 'Tartja a fejét', 'First laugh': 'Első nevetés', 'Rolled over': 'Átfordult',
    'Sat up': 'Felült', 'First tooth': 'Első fog', 'Crawled': 'Mászott', 'First word': 'Első szó', 'First steps': 'Első lépések', 'First bath': 'Első fürdetés',
    'Newborn': 'Újszülött', 'Born': 'Megszületett', 'next stop · tap to add': 'következő állomás · koppints a hozzáadáshoz',
    "{name}'s journey": '{name} útja', 'Add milestone': 'Mérföldkő hozzáadása', 'Edit milestone': 'Mérföldkő szerkesztése',
    'Title': 'Cím', 'e.g. First smile': 'pl. Első mosoly', 'Note (optional)': 'Jegyzet (nem kötelező)', 'what happened': 'mi történt',
    'Photos (optional)': 'Fotók (nem kötelező)', 'Add photos': 'Fotók hozzáadása',
    'Up to {n} photos per milestone.': 'Mérföldkövenként legfeljebb {n} fotó.', 'Preparing {k} of {n}…': 'Előkészítés: {k}/{n}…',
    'Could not read "{name}".': 'Nem sikerült beolvasni: „{name}”.', '{files} skipped — only photos can be added.': '{files} kihagyva — csak fotók adhatók hozzá.',
    'Enter a title': 'Adj meg egy címet', 'Uploading {k} of {n}…': 'Feltöltés: {k}/{n}…', 'Saving…': 'Mentés…', 'Upload failed: {msg}': 'Sikertelen feltöltés: {msg}',
    'Girl · pink theme': 'Lány · rózsaszín téma', 'Boy · blue theme': 'Fiú · kék téma', 'Born {date}': 'Született: {date}',
    'Edit baby': 'Baba adatainak szerkesztése', 'Add another baby': 'Másik baba hozzáadása', 'Medicines': 'Gyógyszerek', 'No medicines yet.': 'Még nincs gyógyszer.',
    '{n}× a day': 'naponta {n}×', 'As needed': 'Szükség szerint', 'Add medicine': 'Gyógyszer hozzáadása',
    'Night mode': 'Éjszakai mód', 'Auto 21–07': 'Auto 21–07', 'Always': 'Mindig', 'Off': 'Ki',
    'Dim, warm colours for night feeds. Auto switches on between 21:00 and 07:00 (this device).': 'Sötét, meleg színek az éjszakai etetéshez. Az Auto 21:00 és 07:00 között kapcsol be (ezen az eszközön).',
    'Language': 'Nyelv', 'Backup': 'Biztonsági mentés',
    'Your data lives on the server and is shared across devices. Export a JSON copy any time.': 'Az adatok a szerveren vannak, minden eszköz ugyanazt látja. JSON másolatot bármikor letölthetsz.',
    'Export data': 'Adatok exportálása', 'Log out': 'Kijelentkezés', 'Delete this baby': 'Baba törlése',
    'baby': 'baba', 'Check-in · {name}': 'Ellenőrzés · {name}', 'Did {name} pee?': '{name} pisilt?', 'Did {name} poo?': '{name} kakilt?',
    'Temperature (°C) — optional': 'Hőmérséklet (°C) — nem kötelező',
    'bottle feed': 'cumisüveges etetés', 'temperature': 'hőmérséklet', 'weight': 'súly', 'length': 'hossz', 'note': 'jegyzet', 'breastfeed': 'szoptatás',
    'pee': 'pisi', 'poo': 'kaki', 'sleep': 'alvás', 'Edit {what}': 'Szerkesztés: {what}', 'Add {what}': 'Új: {what}',
    'Amount (ml)': 'Mennyiség (ml)', 'Side': 'Oldal', 'Both': 'Mindkettő', 'Position': 'Pozíció',
    'Temperature (°C)': 'Hőmérséklet (°C)', 'Weight (kg)': 'Súly (kg)', 'Length (cm)': 'Hossz (cm)',
    'Date': 'Dátum', 'Time': 'Idő', 'Duration': 'Időtartam', 'End time': 'Befejezés', 'Minutes': 'Perc', 'Ends at': 'Vége',
    'No medicines yet. Add them in the Baby tab under "Medicines" first.': 'Még nincs gyógyszer. Előbb add hozzá a Baba fülön a „Gyógyszerek” résznél.',
    'Edit medicine': 'Gyógyszer szerkesztése', 'Log medicine': 'Gyógyszer rögzítése', 'Dose / note (optional)': 'Adag / jegyzet (nem kötelező)', 'e.g. 2.5 ml': 'pl. 2,5 ml',
    'Name': 'Név', 'e.g. Vitamin D': 'pl. D-vitamin', 'Times per day': 'Naponta hányszor', 'Description (optional)': 'Leírás (nem kötelező)',
    'dose, when to give, notes': 'adag, mikor kell adni, megjegyzések',
    "Baby's name": 'A baba neve', 'Sex (sets the theme)': 'Nem (ez adja a témát)', 'Girl · pink': 'Lány · rózsaszín', 'Boy · blue': 'Fiú · kék',
    'Date of birth': 'Születési dátum', 'Save baby': 'Mentés', 'Add baby': 'Baba hozzáadása',
    'Enter a name first': 'Előbb add meg a nevet', 'Enter the date and time of birth': 'Add meg a születés dátumát és idejét',
    'Enter ml': 'Add meg a ml-t', 'Enter temperature': 'Add meg a hőmérsékletet', 'Enter weight': 'Add meg a súlyt', 'Enter length': 'Add meg a hosszt', 'Enter a note': 'Írj jegyzetet',
    'Enter the end time': 'Add meg a befejezés idejét', 'Enter minutes': 'Add meg a perceket', 'Pick a medicine': 'Válassz gyógyszert', 'Enter a name': 'Add meg a nevet',
    'Delete this entry?': 'Törlöd ezt a bejegyzést?', 'Delete these {n}?': 'Törlöd ezt a(z) {n}?', 'Delete {name} and all their data? This cannot be undone.': 'Törlöd {name} babát és minden adatát? Ez nem vonható vissza.',
  },
}
