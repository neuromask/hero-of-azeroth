/**
 * The Collections schema: what a collection is made of, and how SimpleArmory's own tree is folded
 * into the sections a visitor reads.
 *
 * Every shelf is SimpleArmory's: a group at the top (an expansion, an event, a continent), a source
 * under it ("Raid Drop", "Vendor", "Zul'Aman"), and the items under that, exactly as the files they
 * publish name them. A section therefore carries `subgroups`, one per source, and the heading above
 * each is a plain string, taken from that tree and translated here. A bucket the site has not finished
 * filing - it names one "Undiscovered" - is left out of the atlas altogether rather than drawn as a
 * heading that says nothing about where its items come from.
 *
 * A heading is resolved to the language of the page before it leaves the server, so the grid draws
 * it like any other string and no shelf needs a message key that a new expansion would not have.
 * The names come from SimpleArmory in English; `SIMPLEARMORY_LABELS_RU` is the overlay that names
 * the ones Russian reads differently, and a name it does not carry is left in English rather than
 * dropped.
 */

/** The shelves a collection is shown on, which is also how Blizzard spells them. */
export type CollectionKind = 'mounts' | 'pets' | 'toys' | 'decors'

/** The shelves, in the order the collections menu lists them. */
export const COLLECTION_KINDS = ['mounts', 'pets', 'toys', 'decors'] as const

/**
 * The Russian names of the headings SimpleArmory ships, keyed by the English name it ships them
 * under - a group (an expansion, an event) or a source ("Raid Drop", "Vendor", a zone), on any
 * shelf. A name that is a proper noun (an expansion, a vendor, a promotion) is left out on purpose -
 * it reads the same in both languages - so the light in here is only the vocabulary that a Russian
 * collector would not read in English. A name the map does not carry is left in English.
 */
export const SIMPLEARMORY_LABELS_RU: Record<string, string> = {
  // Groups. Every shelf opens with `General`, the bucket holding everything a collector does not earn
  // in one expansion, which the builder files under that name whichever name SimpleArmory gives it.
  General: 'Основное',
  'Limited Time': 'Ограниченное время',
  'Past Limited Time': 'Прошлые ограничения',
  Classic: 'Классика',
  Racial: 'Расовые',
  Professions: 'Профессии',
  'World Events': 'Игровые события',
  Promotion: 'Промоакции',
  Other: 'Прочее',
  // Sources.
  Achievement: 'Достижения',
  Quest: 'Задания',
  Vendor: 'Продавцы',
  Reputation: 'Репутация',
  Reputations: 'Репутация',
  Renown: 'Известность',
  'Raid Renown': 'Рейдовая известность',
  'Paragon Reputation': 'Парагон-репутация',
  'Raid Drop': 'Дроп в рейде',
  'Dungeon Drop': 'Дроп в подземелье',
  'Rare Spawn': 'Редкие существа',
  'Pre-Launch Event': 'Ивент перед запуском',
  'World Boss': 'Мировые боссы',
  'Zone Drop': 'Дроп в локации',
  Zone: 'Локация',
  'Zone Feature': 'Особенность локации',
  Treasure: 'Сокровища',
  Collect: 'Коллекции',
  Toys: 'Игрушки',
  Heirlooms: 'Фамильные реликвии',
  Riddle: 'Загадки',
  Campaign: 'Кампания',
  Events: 'События',
  'Time Rifts': 'Временные разломы',
  'Dream Infusion': 'Наполнение Сна',
  'Emerald Bounty': 'Изумрудная добыча',
  Archives: 'Архивы',
  'Daily Activities': 'Ежедневные занятия',
  Adventures: 'Приключения',
  Torghast: 'Торгаст',
  Tormentors: 'Мучители',
  'Maw Assaults': 'Штурмы Утробы',
  'Maldraxxus Callings': 'Призывы Малдраксуса',
  'Covenant Feature': 'Особенность ковенанта',
  'Night Fae Covenant Features': 'Ночной народец: особенности',
  'Night Fae Quest': 'Ночной народец: задания',
  'Night Fae Rare Spawn': 'Ночной народец: редкие',
  'Night Fae Renown': 'Ночной народец: известность',
  'Night Fae Vendor': 'Ночной народец: продавцы',
  'Kyrian Covenant Features': 'Кирии: особенности',
  'Kyrian Quest': 'Кирии: задания',
  'Kyrian Rare Spawn': 'Кирии: редкие',
  'Kyrian Renown': 'Кирии: известность',
  'Kyrian Vendor': 'Кирии: продавцы',
  'Necrolord Covenant Features': 'Некролорды: особенности',
  'Necrolord Quest': 'Некролорды: задания',
  'Necrolord Rare Spawn': 'Некролорды: редкие',
  'Necrolord Renown': 'Некролорды: известность',
  'Necrolord Vendor': 'Некролорды: продавцы',
  'Venthyr Covenant Features': 'Вентиры: особенности',
  'Venthyr Quest': 'Вентиры: задания',
  'Venthyr Rare Spawn': 'Вентиры: редкие',
  'Venthyr Renown': 'Вентиры: известность',
  'Venthyr Vendor': 'Вентиры: продавцы',
  'Protoform Synthesis': 'Синтез протоформ',
  Medals: 'Медали',
  'Allied Race': 'Союзная раса',
  'Allied Races': 'Союзные расы',
  Tinkering: 'Мастерская',
  'Warfront: Arathi': 'Фронт: Арати',
  'Warfront: Darkshore': 'Фронт: Тёмные берега',
  'Assault: Vale of Eternal Blossoms': 'Вторжение: Долина Вечных Цветов',
  'Assault: Uldum': 'Вторжение: Ульдум',
  'Island Expedition': 'Экспедиции на острова',
  Dubloons: 'Дублоны',
  Visions: 'Видения',
  'Visions Revisited': 'Видения: повторно',
  'Mage Tower': 'Башня магов',
  'Class Hall': 'Оплоты классов',
  Garrison: 'Гарнизон',
  Missions: 'Миссии',
  Stables: 'Стойла',
  'Trading Post': 'Лавка',
  'Fishing Shack': 'Рыболовный домик',
  'Argent Tournament': 'Серебряный турнир',
  'Cenarion Expedition': 'Экспедиция Кенария',
  Netherwing: 'Крылья Пустоты',
  "Sha'tari Skyguard": 'Небесная стража Ша’тар',
  "Kurenai/The Mag'har": 'Куренай / Маг’хары',
  'Challenge Mode': 'Режим испытаний',
  'Golden Lotus': 'Золотой Лотос',
  'Order of the Cloud Serpent': 'Орден Облачного Змея',
  'Shado-Pan': 'Шадо-Пан',
  'Kun-Lai Vendor': 'Продавцы Кунь-Лая',
  'The Tillers': 'Земледельцы',
  'Primal Eggs': 'Первобытные яйца',
  'Timelost Saddle': 'Седло Вневременного острова',
  Champion: 'Чемпион',
  'Mark of Honor': 'Знаки чести',
  Honor: 'Честь',
  Halaa: 'Халаа',
  'Timeless Isle': 'Вневременный остров',
  Ashran: 'Ашран',
  'Vicious Saddle': 'Жестокое седло',
  Gladiator: 'Гладиатор',
  "Talon's Vengeance": 'Месть Когтя',
  Brewfest: 'Хмельной фестиваль',
  "Hallow's End": 'Тыквовин',
  'Love is in the Air': 'Любовная лихорадка',
  Noblegarden: 'Сад благородных',
  'Winter Veil': 'Зимний покров',
  'Lunar Festival': 'Лунный фестиваль',
  'Midsummer Fire Festival': 'Фестиваль Огня',
  "Brawler's Guild": 'Клуб бойцов',
  'Darkmoon Faire': 'Ярмарка Новолуния',
  Timewalking: 'Путешествия во времени',
  Anniversary: 'Годовщины',
  'Midnight: Season 2': 'Midnight: сезон 2',
  'Trading Post: October': 'Лавка: октябрь',
  'Nemesis Drop': 'Дроп с заклятого врага',
  'Prey Drop': 'Дроп с добычи',
  'Ritual Sites': 'Ритуальные места',
  'Trading Post Originals': 'Лавка: оригиналы',
  'Trading Post Re-Releases': 'Лавка: переиздания',
  'Dastardly Duos': 'Злодейские дуэты',
  'Decor Duels': 'Дуэли декора',
  'Greedy Emissary': 'Жадный посланник',
  'Remix: Pandaria': 'Remix: Пандария',
  'Remix: Legion': 'Remix: Легион',
  'Blizzard Store': 'Магазин Blizzard',
  'Player Vote': 'Выбор игроков',
  "Collector's Edition": 'Коллекционное издание',
  'Blizzard Anniversary': 'Годовщина Blizzard',
  '20th Anniversary': '20-я годовщина',
  'Recruit-A-Friend': 'Приведи друга',
  'Trading Card Game / Auction House': 'ККИ / Аукцион',
  'Annual Subscription': 'Годовая подписка',
  Paladin: 'Паладины',
  'Demon Hunter': 'Охотники на демонов',
  Warlock: 'Чернокнижники',
  'Death Knight': 'Рыцари смерти',
  'Guild Vendor': 'Гильдейские торговцы',
  BMAH: 'Чёрный рынок',
  'Feats of Strength': 'Подвиги',
  'Make-A-Wish': 'Make-A-Wish',
  Unknown: 'Неизвестно',
  Human: 'Люди',
  Dwarf: 'Дворфы',
  'Night Elf': 'Ночные эльфы',
  Gnome: 'Гномы',
  Draenei: 'Дренеи',
  Worgen: 'Воргены',
  Pandaren: 'Пандарены',
  Dracthyr: 'Драктиры',
  Orc: 'Орки',
  Undead: 'Нежить',
  Tauren: 'Таурены',
  Troll: 'Тролли',
  Goblin: 'Гоблины',
  'Blood Elf': 'Кровавые эльфы',
  Alchemy: 'Алхимия',
  Archaeology: 'Археология',
  Engineering: 'Инженерное дело',
  Fishing: 'Рыбная ловля',
  Jewelcrafting: 'Ювелирное дело',
  Tailoring: 'Портняжное дело',
  Leatherworking: 'Кожевничество',
  Blacksmith: 'Кузнечное дело',
  'Obsidian Citadel': 'Обсидиановая цитадель',
  'Zskera Vaults': 'Хранилища Зскера',
  // The pets and the toys, and the vocabulary the mount tree shares with them.
  Achievements: 'Достижения',
  'World Event': 'Игровые события',
  Profession: 'Профессии',
  Promotional: 'Промоакции',
  'Rare Drop': 'Редкий дроп',
  Rare: 'Редкие',
  'World Drop': 'Мировой дроп',
  'World Drop: Kalimdor': 'Мировой дроп: Калимдор',
  'World Drop: Eastern Kingdoms': 'Мировой дроп: Восточные королевства',
  'Alliance Vendor': 'Торговец Альянса',
  'Horde Vendor': 'Торговец Орды',
  'Alliance Territory': 'Территория Альянса',
  'Horde Territory': 'Территория Орды',
  'Multiple Zones': 'Разные зоны',
  'Multiple Continents': 'Разные континенты',
  'Pet Battle': 'Битвы питомцев',
  'Pet Battles': 'Битвы питомцев',
  'Pet Battle Dungeon': 'Подземелья битв питомцев',
  'Tanaan Pet Battle': 'Битвы питомцев Танаана',
  'Pet Charm': 'Жетон питомца',
  'Pet Charms': 'Жетоны питомцев',
  Heritage: 'Наследие',
  Lorewalking: 'Хождения по историям',
  Delves: 'Вылазки',
  Emissary: 'Эмиссар',
  Callings: 'Призывы',
  Mission: 'Миссия',
  Scenario: 'Сценарий',
  Raid: 'Рейд',
  Dungeon: 'Подземелье',
  Assault: 'Вторжение',
  'Island Expeditions': 'Островные экспедиции',
  'Covenant Sanctum': 'Обитель ковенанта',
  'Order Hall': 'Оплот ордена',
  'Table Missions': 'Задания со стола',
  'Grand Hunt': 'Великая охота',
  'Cracked Egg': 'Треснувшее яйцо',
  'Fel Egg': 'Яйцо Скверны',
  'Darkmoon Island': 'Остров Новолуния',
  'Molten Front': 'Огненные Просторы',
  'Mount Hyjal': 'Хиджал',
  'Celestial Tournament': 'Небесный турнир',
  'Storm Events': 'Штормовые события',
  'Horrific Visions': 'Жуткие видения',
  'Whelp Daycare': 'Ясли для дракончиков',
  Falcosaur: 'Соколозавры',
  'Critters of Draenor': 'Зверьки Дренора',
  'Ecological Succession': 'Экологическая сукцессия',
  'Great Gnomeregan Run': 'Большой гномреганский забег',
  'Darkspear Dash': 'Забег Черного Копья',
  'Dragonriding Cup': 'Кубок гонок на драконах',
  'Feast of Winter Veil': 'Пир Зимнего Покрова',
  Midsummer: 'Праздник Огня',
  "Children's Week": 'Детская неделя',
  "Pilgrim's Bounty": 'День урожая',
  "Pirate's Day": 'День пирата',
  'Day of the Dead': 'День мертвых',
  'Challenge: Wailing Caverns': 'Испытание: Пещеры Стенаний',
  'Challenge: Deadmines': 'Испытание: Мертвые копи',
  'Challenge: Gnomeregan': 'Испытание: Гномреган',
  'Challenge: Stratholme': 'Испытание: Стратхольм',
  'Challenge: Blackrock Depths': 'Испытание: Глубины Черной горы',
  // The continents and zones a wild pet is caught in, and the ground the pets and toys of a patch
  // are earned on.
  Kalimdor: 'Калимдор',
  'Eastern Kingdoms': 'Восточные королевства',
  Outland: 'Запределье',
  Northrend: 'Нордскол',
  Pandaria: 'Пандария',
  Draenor: 'Дренор',
  Ardenweald: 'Арденвельд',
  Bastion: 'Бастион',
  Maldraxxus: 'Малдраксус',
  Revendreth: 'Ревендрет',
  'The Maw': 'Утроба',
  Korthia: 'Кортия',
  Tazavesh: 'Тазавеш',
  'Zereth Mortis': 'Зерет Мортис',
  Nazmir: 'Назмир',
  Drustvar: 'Друствар',
  'Stormsong Valley': 'Долина Штормов',
  'Tiragarde Sound': 'Тирагардское поморье',
  "Vol'dun": 'Вол’дун',
  Zuldazar: 'Зулдазар',
  Nazjatar: 'Назжатар',
  Mechagon: 'Мехагон',
  Uldum: 'Ульдум',
  Deepholm: 'Подземье',
  'Twilight Highlands': 'Сумеречное нагорье',
  'Dread Wastes': 'Жуткие Пустоши',
  'Krasarang Wilds': 'Красарангские джунгли',
  'Kun-Lai Summit': 'Вершина Кунь-Лай',
  'The Jade Forest': 'Нефритовый лес',
  'Townlong Steppes': 'Танлунские степи',
  'Vale of Eternal Blossoms': 'Долина Вечных Цветов',
  'Valley of the Four Winds': 'Долина Четырех Ветров',
  'Isle of Thunder': 'Остров Грома',
  'Frostfire Ridge': 'Хребет Ледяного Огня',
  'Shadowmoon Valley': 'Долина Призрачной Луны',
  Gorgrond: 'Горгронд',
  Talador: 'Таладор',
  'Spires of Arak': 'Пики Арака',
  Nagrand: 'Награнд',
  'Tanaan Jungle': 'Танаанские джунгли',
  Azsuna: 'Азсуна',
  "Val'sharah": 'Валь’шара',
  Highmountain: 'Крутогорье',
  Stormheim: 'Штормхейм',
  Suramar: 'Сурамар',
  Dalaran: 'Даларан',
  Eredath: 'Эредат',
  Krokuun: 'Крокуун',
  'Antoran Wastes': 'Анторанские пустоши',
  'Borean Tundra': 'Борейская тундра',
  'Howling Fjord': 'Ревущий фьорд',
  Dragonblight: 'Драконий Погост',
  'Grizzly Hills': 'Седые холмы',
  'Sholazar Basin': 'Низина Шолазар',
  'The Storm Peaks': 'Грозовая Вершина',
  Icecrown: 'Ледяная Корона',
  "Zul'Drak": 'Зул’Драк',
  Coldarra: 'Хладарра',
  "Blade's Edge Mountains": 'Горы Лезвия Ветра',
  Netherstorm: 'Пустоверть',
  Zangarmarsh: 'Зангартопь',
  'Terokkar Forest': 'Лес Тероккар',
  'The Waking Shores': 'Пробуждающиеся берега',
  "Ohn'ahran Plains": 'Он’ахарские равнины',
  'The Azure Span': 'Лазурные Просторы',
  Thaldraszus: 'Тальдразу',
  'Zaralek Cavern': 'Пещера Заралек',
  'The Emerald Dream': 'Изумрудный Сон',
  'The Forbidden Reach': 'Запретный Край',
  'The Zskera Vaults': 'Хранилища Зскера',
  'Isle of Dorn': 'Остров Дорн',
  'The Ringing Deeps': 'Звенящие Глубины',
  'Azj-Kahet': 'Азж-Кахет',
  'Siren Isle': 'Остров Сирен',
  "Zul'Aman": 'Зул’Аман',
  'Eversong Woods': 'Леса Вечной Песни',
  "Isle of Quel'Danas": 'Остров Кель’Данас',
  'Silvermoon City': 'Луносвет',
  // Russian translation names them, the newest as the game and its players write them.
  // The decorations' own vocabulary: the housing side of the game, and the sources a decoration is
  // bought or earned through.
  Neighbourhoods: 'Районы',
  'Neighbourhood Vendor': 'Продавец в районе',
  'Holiday Vendor': 'Праздничный продавец',
  'Alliance Reputation': 'Репутация Альянса',
  'Horde Reputation': 'Репутация Орды',
  'Alliance Garrison Vendor': 'Продавец гарнизона Альянса',
  'Horde Garrison Vendor': 'Продавец гарнизона Орды',
  'Garrison Vendor': 'Продавец гарнизона',
  Assaults: 'Вторжения',
  'Class Hall Vendors': 'Продавцы оплота',
  'Class Hall Achievements': 'Достижения оплота',
  Paragon: 'Парагон',
  Participation: 'Участие',
  'Marks of Honor': 'Знаки чести',
  'House Level': 'Уровень дома',
  'Mechagon Tinkering': 'Мехагон: мастерская',
  'Mechagon Dailies': 'Мехагон: ежедневные задания',
  'Dracthyr Quest': 'Задания драктиров',
  'Expansion Editions': 'Издания дополнений',
  Prey: 'Добыча',
}

/** One item on a shelf: what it is, how it looks, and whether this character has it. */
export interface CollectionItem {
  /** Blizzard's id for the mount, the pet species or the toy. */
  id: number
  /** The name, in the language the page is being read in. */
  name: string
  /** The square's address on ZamImg, built from the icon name SimpleArmory stores for the item. */
  icon: string
  /**
   * Blizzard's own 2D copy of the same icon, which the grid falls back on when ZamImg does not serve
   * the name: a sprite the one CDN has not got may still be on the other. Empty only for a row with
   * no icon name at all, which the grid draws as the question mark instead.
   */
  fallback: string
  /** Whether the character being read holds it. */
  collected: boolean
  /**
   * The `type`/`id` a Wowhead tooltip answers to, written down when the atlas was built from the ids
   * SimpleArmory carries: a mount's item or the spell that summons it, a pet's creature (a battle pet
   * is a Wowhead NPC, not the `pet=` hunter-pet family it used to be), a toy's item. `null` for a row
   * that has no such id - a file that names none - which the grid draws as a plain tile rather than a
   * link to nowhere.
   */
  wow: { type: 'item' | 'spell' | 'npc'; id: number } | null
}

/**
 * One source inside a group: the "Raid Drop" or "Vendor" heading under an expansion, and the items
 * filed under it. Its heading is a plain string, already read in the page's language.
 */
export interface CollectionSubgroup {
  id: string
  label: string
  collected: number
  total: number
  items: CollectionItem[]
}

/**
 * One section of a shelf: the sources it is cut into and the count the heading above them is measured
 * by. The sources are already dropped off it when they came out empty, so a section always has at
 * least the one the grid draws.
 */
export interface CollectionSection {
  id: string
  /** The heading, already read in the page's language. */
  label: string
  collected: number
  total: number
  /** The share of the section the character holds, rounded to a whole percent. */
  percent: number
  /** The source rows drawn under the heading, one block of tiles each. */
  subgroups: CollectionSubgroup[]
}

/** A whole shelf, ready to draw: the sections and the running total they add up to. */
export interface CollectionPage {
  kind: CollectionKind
  collected: number
  total: number
  percent: number
  sections: CollectionSection[]
  /** When the shelf was assembled, so a caller can tell a fresh copy from a revalidated one. */
  generatedAt: number
}