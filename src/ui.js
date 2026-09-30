/**
 * The page's own chrome - top bar, filter labels, list messages - in the
 * picked language.
 *
 * Everything the game names comes from the game: rows, tooltips, the rail's
 * group names and the Category picks are all translated by the extractor out
 * of the mod's lang files. These strings are the site's alone, so the game has
 * nothing to offer for most of them and they are translated here, by hand.
 *
 * Where the game *does* have the word - the in-game wiki's own filter labels,
 * "Level", "Rarity" - it wins over this table whenever the picked language
 * translates it, so the page says what the game says.
 */

// ui id -> the lang key the game uses for the same word
const GAME_KEYS = {
  level: "mmorpg.word.level",
  rarity: "mmorpg.item_tips.rarity_tip",
  affixType: "mmorpg.word.affix_types",
  runeCount: "mmorpg.word.rune_count",
  league: "mmorpg.word.league",
  tier: "mmorpg.word.tier",
  tag: "mmorpg.word.tags",
  // the tooltips' labels. Most of these are the game's "Cast Time: %1$ss"
  // sentences, and the label is what stands before the colon
  onSlots: "mmorpg.word.on_slots",
  stats: "mmorpg.word.stats",
  sockWeapon: "mmorpg.word.weapon",
  sockArmor: "mmorpg.word.armor",
  sockJewelry: "mmorpg.word.jewerly",
  supportGem: "mmorpg.word.suppgem",
  augment: "mmorpg.word.aura",
  manaCost: "mmorpg.word.mana_cost",
  eneCost: "mmorpg.word.ene_cost",
  bloodCost: "mmorpg.word.blood_cost",
  castTime: "mmorpg.word.cast_time",
  cooldown: "mmorpg.word.cooldown",
  recovery: "mmorpg.word.recovery",
  maxCharges: "mmorpg.word.max_charges",
  chargeRegen: "mmorpg.word.charge_regen",
  procRecharge: "mmorpg.word.proc_recharge",
  minDropLevel: "mmorpg.word.min_drop_level",
  minMapTier: "mmorpg.word.min_drop_tier",
  exp: "mmorpg.word.exp",
  source: "mmorpg.word.source",
};

const L = ["en", "es_es", "fr_fr", "ja_jp", "ko_kr", "pt_br", "ru_ru", "uk_ua", "zh_cn", "zh_tw"];

// one row per string, one column per entry of L; {n} is filled in by t()
const TABLE = {
  version: ["Version", "Versión", "Version", "バージョン", "버전", "Versão", "Версия", "Версія", "版本", "版本"],
  language: ["Language", "Idioma", "Langue", "言語", "언어", "Idioma", "Язык", "Мова", "语言", "語言"],
  langTip: [
    "The mod's own translations. The pack adds its content in English only, so most skills and uniques stay English in every language.",
    "Las traducciones del propio mod. El modpack añade su contenido solo en inglés, así que la mayoría de habilidades y objetos únicos siguen en inglés en todos los idiomas.",
    "Les traductions du mod lui-même. Le modpack ajoute son contenu en anglais uniquement, donc la plupart des compétences et des objets uniques restent en anglais dans toutes les langues.",
    "Mod本体の翻訳です。モッドパックが追加する内容は英語のみのため、ほとんどのスキルとユニークはどの言語でも英語のままです。",
    "모드 자체의 번역입니다. 모드팩이 추가하는 콘텐츠는 영어로만 제공되므로, 대부분의 스킬과 유니크는 어떤 언어에서도 영어로 남습니다.",
    "As traduções do próprio mod. O modpack adiciona seu conteúdo apenas em inglês, então a maioria das habilidades e itens únicos continua em inglês em todos os idiomas.",
    "Переводы самого мода. Сборка добавляет свой контент только на английском, поэтому большинство умений и уникальных предметов остаются на английском в любом языке.",
    "Переклади самого мода. Збірка додає свій вміст лише англійською, тому більшість умінь і унікальних предметів лишаються англійською будь-якою мовою.",
    "模组自带的翻译。整合包新增的内容只有英文，因此大多数技能和独特装备在任何语言下都仍是英文。",
    "模組自帶的翻譯。模組包新增的內容只有英文，因此大多數技能與特殊裝備在任何語言下都仍是英文。",
  ],
  level: ["Level", "Nivel", "Niveau", "レベル", "레벨", "Nível", "Уровень", "Рівень", "等级", "等級"],
  skillLvl: ["Skill Lvl", "Nv. habilidad", "Niv. compétence", "スキルLv", "스킬 레벨", "Nv. habilidade", "Ур. умения", "Рів. вміння", "技能等级", "技能等級"],
  skillTip: [
    "A skill gem's own rank, separate from your character level. Leave it empty for the skill's natural maximum; gear can push it past that.",
    "El rango de la propia gema de habilidad, distinto del nivel de tu personaje. Déjalo vacío para el máximo natural de la habilidad; el equipo puede superarlo.",
    "Le rang propre de la gemme de compétence, distinct du niveau de votre personnage. Laissez vide pour le maximum naturel de la compétence ; l'équipement peut le dépasser.",
    "スキルジェム自体のランクで、キャラクターレベルとは別です。空欄にするとスキル本来の最大値になり、装備でそれを超えられます。",
    "캐릭터 레벨과는 별개인 스킬 젬 자체의 랭크입니다. 비워 두면 스킬의 기본 최대치가 되며, 장비로 그 이상 올릴 수 있습니다.",
    "O rank da própria gema de habilidade, separado do nível do seu personagem. Deixe vazio para o máximo natural da habilidade; o equipamento pode ultrapassá-lo.",
    "Собственный ранг камня умения, отдельный от уровня персонажа. Оставьте пустым для естественного максимума умения; снаряжение может поднять его выше.",
    "Власний ранг каменя вміння, окремий від рівня персонажа. Залиште порожнім для природного максимуму вміння; спорядження може підняти його вище.",
    "技能宝石自身的等级，与角色等级无关。留空则为该技能的自然上限；装备可以使其超过上限。",
    "技能寶石自身的等級，與角色等級無關。留空則為該技能的自然上限；裝備可以使其超過上限。",
  ],
  max: ["max", "máx.", "max", "最大", "최대", "máx.", "макс.", "макс.", "最大", "最大"],
  maxN: ["max {n}", "máx. {n}", "max {n}", "最大 {n}", "최대 {n}", "máx. {n}", "макс. {n}", "макс. {n}", "最大 {n}", "最大 {n}"],
  search: ["Search", "Buscar", "Rechercher", "検索", "검색", "Buscar", "Поиск", "Пошук", "搜索", "搜尋"],
  searchPh: ["Name or id…", "Nombre o id…", "Nom ou id…", "名前またはID…", "이름 또는 ID…", "Nome ou id…", "Название или id…", "Назва або id…", "名称或 ID…", "名稱或 ID…"],
  searchTips: ["Search tooltips", "Buscar en descripciones", "Chercher dans les infobulles", "ツールチップも検索", "툴팁 내용도 검색", "Buscar nas descrições", "Искать в подсказках", "Шукати в підказках", "搜索提示内容", "搜尋提示內容"],
  categories: ["Categories", "Categorías", "Catégories", "カテゴリー", "카테고리", "Categorias", "Категории", "Категорії", "分类", "分類"],

  category: ["Category", "Categoría", "Catégorie", "カテゴリー", "카테고리", "Categoria", "Категория", "Категорія", "分类", "分類"],
  affixType: ["Affix Type", "Tipo de afijo", "Type d'affixe", "アフィックスの種類", "수식어 유형", "Tipo de afixo", "Тип аффикса", "Тип модифікатора", "词缀类型", "詞綴類型"],
  baseItem: ["Base Item", "Objeto base", "Objet de base", "ベースアイテム", "기본 아이템", "Item base", "Базовый предмет", "Базовий предмет", "基础物品", "基礎物品"],
  tag: ["Tag", "Etiqueta", "Tag", "タグ", "태그", "Tag", "Тег", "Тег", "标签", "標籤"],
  set: ["Set", "Conjunto", "Ensemble", "セット", "세트", "Conjunto", "Комплект", "Комплект", "套装", "套裝"],
  league: ["League", "Liga", "Ligue", "リーグ", "리그", "Liga", "Лига", "Ліга", "赛季", "賽季"],
  runeCount: ["Rune Count", "Número de runas", "Nombre de runes", "ルーン数", "룬 개수", "Número de runas", "Количество рун", "Кількість рун", "符文数量", "符文數量"],
  slot: ["Slot", "Ranura", "Emplacement", "スロット", "슬롯", "Espaço", "Слот", "Слот", "部位", "部位"],
  class: ["Class", "Clase", "Classe", "クラス", "클래스", "Classe", "Класс", "Клас", "职业", "職業"],
  style: ["Style", "Estilo", "Style", "スタイル", "스타일", "Estilo", "Стиль", "Стиль", "风格", "風格"],
  type: ["Type", "Tipo", "Type", "種類", "유형", "Tipo", "Тип", "Тип", "类型", "類型"],
  gemType: ["Gem Type", "Tipo de gema", "Type de gemme", "ジェムの種類", "보석 유형", "Tipo de gema", "Тип камня", "Тип каменя", "宝石类型", "寶石類型"],
  tier: ["Tier", "Grado", "Palier", "ティア", "티어", "Grau", "Тир", "Тір", "等阶", "等階"],
  rarity: ["Rarity", "Rareza", "Rareté", "レアリティ", "희귀도", "Raridade", "Редкость", "Рідкість", "稀有度", "稀有度"],
  profession: ["Profession", "Profesión", "Métier", "生活職業", "전문기술", "Profissão", "Профессия", "Професія", "生活职业", "生活職業"],

  any: ["Any", "Cualquiera", "Tous", "すべて", "전체", "Qualquer", "Любой", "Будь-який", "全部", "全部"],
  anyFull: ["Any (full range)", "Cualquiera (rango completo)", "Toutes (plage complète)", "すべて（全範囲）", "전체 (전체 범위)", "Qualquer (faixa completa)", "Любая (полный диапазон)", "Будь-яка (повний діапазон)", "全部（完整范围）", "全部（完整範圍）"],
  count: ["{n} of {total}", "{n} de {total}", "{n} sur {total}", "{n} / {total}", "{total}개 중 {n}개", "{n} de {total}", "{n} из {total}", "{n} з {total}", "{n} / {total}", "{n} / {total}"],
  nothing: ["Nothing matches.", "Ningún resultado.", "Aucun résultat.", "該当なし。", "일치하는 항목이 없습니다.", "Nenhum resultado.", "Ничего не найдено.", "Нічого не знайдено.", "没有匹配项。", "沒有符合的項目。"],
  pick: ["Pick an entry.", "Elige una entrada.", "Choisissez une entrée.", "項目を選んでください。", "항목을 선택하세요.", "Escolha uma entrada.", "Выберите запись.", "Виберіть запис.", "请选择一个条目。", "請選擇一個條目。"],
  // ---- tooltips. Labels only - every name, stat and description in a
  // tooltip is the game's own text
  anyRarity: ["Any rarity (full range)", "Cualquier rareza (rango completo)", "Toute rareté (plage complète)", "すべてのレアリティ（全範囲）", "모든 희귀도 (전체 범위)", "Qualquer raridade (faixa completa)", "Любая редкость (полный диапазон)", "Будь-яка рідкість (повний діапазон)", "任意稀有度（完整范围）", "任意稀有度（完整範圍）"],
  tagReq: ["Tag Requirements", "Requisitos de etiqueta", "Tags requis", "タグ条件", "태그 요구 조건", "Requisitos de tag", "Требуемые теги", "Потрібні теги", "标签要求", "標籤需求"],
  tagReqAll: ["Needs every tag", "Requiere todas las etiquetas", "Nécessite tous les tags", "すべてのタグが必要", "모든 태그 필요", "Requer todas as tags", "Нужны все теги", "Потрібні всі теги", "需要全部标签", "需要全部標籤"],
  canRollOn: ["Can Roll On", "Puede aparecer en", "Peut apparaître sur", "付与可能な装備", "등장 가능 장비", "Pode aparecer em", "Может выпасть на", "Може випасти на", "可出现于", "可出現於"],
  weight: ["Weight", "Peso", "Poids", "重み", "가중치", "Peso", "Вес", "Вага", "权重", "權重"],
  id: ["Id", "ID", "ID", "ID", "ID", "ID", "ID", "ID", "ID", "ID"],
  minLevel: ["Min Level", "Nivel mín.", "Niveau min.", "最低レベル", "최소 레벨", "Nível mín.", "Мин. уровень", "Мін. рівень", "最低等级", "最低等級"],
  minDropLevel: ["Min Level", "Nivel mín. de botín", "Niveau min. de butin", "最低ドロップレベル", "최소 드랍 레벨", "Nível mín. de drop", "Мин. уровень выпадения", "Мін. рівень випадіння", "最低掉落等级", "最低掉落等級"],
  minMapTier: ["Min Map Tier", "Grado mín. de mapa", "Palier de carte min.", "最低マップティア", "최소 지도 티어", "Grau mín. de mapa", "Мин. тир карты", "Мін. тір мапи", "最低地图等阶", "最低地圖等階"],
  onSlots: ["On Slots", "En ranuras", "Emplacements", "スロット", "슬롯", "Nos espaços", "Слоты", "Слоти", "栏位", "欄位"],
  stats: ["Stats", "Estadísticas", "Statistiques", "ステータス", "스탯", "Atributos", "Характеристики", "Характеристики", "属性", "屬性"],
  sockWeapon: ["Weapons", "Armas", "Armes", "武器", "무기", "Armas", "Оружие", "Зброя", "武器", "武器"],
  sockArmor: ["Armor", "Armadura", "Armure", "防具", "방어구", "Armadura", "Броня", "Броня", "护甲", "護甲"],
  sockJewelry: ["Jewelry", "Joyería", "Bijoux", "アクセサリー", "장신구", "Joias", "Украшения", "Прикраси", "饰品", "飾品"],
  supportGem: ["Support Gem", "Gema de apoyo", "Gemme de soutien", "サポートジェム", "보조 젬", "Gema de suporte", "Камень поддержки", "Камінь підтримки", "辅助宝石", "輔助寶石"],
  augment: ["Augment", "Aumento", "Augment", "オーグメント", "증강", "Aumento", "Усиление", "Посилення", "增幅", "增幅"],
  triggers: ["Triggers", "Activa", "Déclenche", "発動", "발동", "Ativa", "Вызывает", "Викликає", "触发", "觸發"],
  maxStacks: ["Max Stacks", "Acumulaciones máx.", "Cumuls max.", "最大スタック", "최대 중첩", "Acúmulos máx.", "Макс. стаков", "Макс. стаків", "最大层数", "最大層數"],
  eff_beneficial: ["Beneficial", "Beneficioso", "Bénéfique", "有益", "이로운 효과", "Benéfico", "Положительный", "Позитивний", "增益", "增益"],
  eff_negative: ["Negative", "Negativo", "Négatif", "有害", "해로운 효과", "Negativo", "Отрицательный", "Негативний", "减益", "減益"],
  manaCost: ["Mana Cost", "Coste de maná", "Coût en mana", "マナコスト", "마나 소모", "Custo de mana", "Стоимость маны", "Вартість мани", "法力消耗", "法力消耗"],
  eneCost: ["Energy Cost", "Coste de energía", "Coût en énergie", "エネルギーコスト", "기력 소모", "Custo de energia", "Затраты энергии", "Витрати енергії", "能量消耗", "能量消耗"],
  bloodCost: ["Blood Cost", "Coste de sangre", "Coût en sang", "ブラッドコスト", "피 소모", "Custo de sangue", "Затраты крови", "Витрати крові", "鲜血消耗", "鮮血消耗"],
  bloodMage: ["Blood Mage", "Mago de sangre", "Mage de sang", "ブラッドメイジ", "피의 마법사", "Mago de sangue", "Маг крови", "Маг крові", "鲜血法师", "鮮血法師"],
  maxCharges: ["Max Charges", "Cargas máx.", "Charges max.", "最大チャージ", "최대 충전", "Cargas máx.", "Макс. зарядов", "Макс. зарядів", "最大充能", "最大充能"],
  chargeRegen: ["Charge Regen", "Regeneración de cargas", "Régén. des charges", "チャージ回復", "충전 재생", "Regeneração de cargas", "Восстановление зарядов", "Відновлення зарядів", "充能恢复", "充能恢復"],
  cooldown: ["Cooldown", "Enfriamiento", "Temps de recharge", "クールダウン", "재사용 대기시간", "Recarga", "Перезарядка", "Перезарядка", "冷却时间", "冷卻時間"],
  recovery: ["Recovery", "Recuperación", "Récupération", "リカバリー", "회복", "Recuperação", "Восстановление", "Відновлення", "恢复时间", "恢復時間"],
  channelPulse: ["Channel Pulse", "Pulso canalizado", "Impulsion canalisée", "チャネル間隔", "정신 집중 주기", "Pulso canalizado", "Импульс канала", "Імпульс каналу", "引导脉冲", "引導脈衝"],
  castTime: ["Cast Time", "Tiempo de lanzamiento", "Temps d'incantation", "詠唱時間", "시전 시간", "Tempo de conjuração", "Время применения", "Час застосування", "施法时间", "施法時間"],
  instant: ["Instant", "Instantáneo", "Instantané", "即時", "즉시", "Instantâneo", "Мгновенно", "Миттєво", "瞬发", "瞬發"],
  procRecharge: ["Proc Recharge", "Recarga de activación", "Recharge de déclenchement", "発動リチャージ", "발동 재충전", "Recarga de ativação", "Восстановление срабатывания", "Відновлення спрацювання", "触发间隔", "觸發間隔"],
  noLimit: ["no limit", "sin límite", "aucune limite", "制限なし", "제한 없음", "sem limite", "без ограничений", "без обмежень", "无限制", "無限制"],
  applies: ["Applies", "Aplica", "Applique", "付与", "부여", "Aplica", "Накладывает", "Накладає", "施加", "施加"],
  removes: ["Removes", "Elimina", "Retire", "除去", "제거", "Remove", "Снимает", "Знімає", "移除", "移除"],
  gemStatsAt: ["Gem Stats at Level {n}", "Estadísticas de la gema al nivel {n}", "Statistiques de la gemme au niveau {n}", "レベル{n}のジェムステータス", "{n}레벨 젬 스탯", "Atributos da gema no nível {n}", "Характеристики камня на уровне {n}", "Характеристики каменя на рівні {n}", "{n}级宝石属性", "{n}級寶石屬性"],
  weapon: ["Weapon", "Arma", "Arme", "武器", "무기", "Arma", "Оружие", "Зброя", "武器", "武器"],
  anyWeapon: ["Any Weapon", "Cualquier arma", "Toute arme", "任意の武器", "모든 무기", "Qualquer arma", "Любое оружие", "Будь-яка зброя", "任意武器", "任意武器"],
  nonMageWeapon: ["Non-Mage Weapon", "Arma no mágica", "Arme non magique", "魔法武器以外", "비마법 무기", "Arma não mágica", "Не магическое оружие", "Не магічна зброя", "非法师武器", "非法師武器"],
  requiresLevel: ["Requires Level", "Requiere nivel", "Niveau requis", "必要レベル", "요구 레벨", "Requer nível", "Требуемый уровень", "Потрібний рівень", "需求等级", "需求等級"],
  maxGemLevel: ["Max Gem Level", "Nivel máx. de gema", "Niveau max. de gemme", "最大ジェムレベル", "최대 젬 레벨", "Nível máx. da gema", "Макс. уровень камня", "Макс. рівень каменя", "宝石等级上限", "寶石等級上限"],
  withGear: ["{n} with gear", "{n} con equipo", "{n} avec l'équipement", "装備込みで{n}", "장비 포함 {n}", "{n} com equipamento", "{n} со снаряжением", "{n} зі спорядженням", "装备加成后 {n}", "裝備加成後 {n}"],
  skillLevel: ["Skill Level", "Nivel de habilidad", "Niveau de compétence", "スキルレベル", "스킬 레벨", "Nível da habilidade", "Уровень умения", "Рівень уміння", "技能等级", "技能等級"],
  fromGear: ["+{n} from gear", "+{n} del equipo", "+{n} de l'équipement", "装備で+{n}", "장비로 +{n}", "+{n} do equipamento", "+{n} от снаряжения", "+{n} від спорядження", "装备 +{n}", "裝備 +{n}"],
  rankedBy: ["ranked by {name}", "rango de {name}", "rang de {name}", "{name}のランクに依存", "{name}의 랭크 사용", "rank de {name}", "ранг от {name}", "ранг від {name}", "等级取决于{name}", "等級取決於{name}"],
  oneOf: ["One of", "Uno de", "L'un de", "次のいずれか", "다음 중 하나", "Um de", "Одно из", "Одне з", "以下之一", "以下之一"],
  requires: ["Requires", "Requiere", "Requiert", "必要条件", "요구 조건", "Requer", "Требует", "Потребує", "需求", "需求"],
  potentialCost: ["Potential Cost", "Coste de potencial", "Coût en potentiel", "ポテンシャルコスト", "잠재력 소모", "Custo de potencial", "Стоимость потенциала", "Вартість потенціалу", "潜能消耗", "潛能消耗"],
  exp: ["Exp", "Exp.", "Exp", "経験値", "경험치", "Exp", "Опыт", "Досвід", "经验", "經驗"],
  source: ["Source", "Fuente", "Source", "入手元", "획득처", "Fonte", "Источник", "Джерело", "来源", "來源"],
  manaMulti: ["Mana Multiplier", "Multiplicador de maná", "Multiplicateur de mana", "マナ倍率", "마나 배율", "Multiplicador de mana", "Множитель маны", "Множник мани", "法力倍率", "法力倍率"],
  reservation: ["Reservation", "Reserva", "Réservation", "リザーブ", "예약", "Reserva", "Резерв", "Резерв", "保留", "保留"],
  onSelf: ["on self", "en uno mismo", "sur soi", "自身に", "자신에게", "em si mesmo", "на себя", "на себе", "作用于自身", "作用於自身"],
  onTarget: ["on target", "en el objetivo", "sur la cible", "対象に", "대상에게", "no alvo", "на цель", "на ціль", "作用于目标", "作用於目標"],
  permanent: ["permanent", "permanente", "permanent", "永続", "영구", "permanente", "постоянно", "постійно", "永久", "永久"],
  nStacks: ["{n} stacks", "{n} acumulaciones", "{n} cumuls", "{n}スタック", "{n}중첩", "{n} acúmulos", "стаков: {n}", "стаків: {n}", "{n}层", "{n}層"],
  oneStack: ["1 stack", "1 acumulación", "1 cumul", "1スタック", "1중첩", "1 acúmulo", "1 стак", "1 стак", "1层", "1層"],
  allStacks: ["all stacks", "todas las acumulaciones", "tous les cumuls", "全スタック", "모든 중첩", "todos os acúmulos", "все стаки", "усі стаки", "全部层数", "全部層數"],
  stacksTo: ["stacks to {n}", "hasta {n} acumulaciones", "jusqu'à {n} cumuls", "最大{n}スタック", "최대 {n}중첩", "até {n} acúmulos", "до {n} стаков", "до {n} стаків", "最多叠加{n}层", "最多疊加{n}層"],
  chance: ["{n}% chance", "{n}% de probabilidad", "{n}% de chance", "{n}%の確率", "{n}% 확률", "{n}% de chance", "шанс {n}%", "шанс {n}%", "{n}%几率", "{n}%機率"],
  via: ["via {name}", "mediante {name}", "via {name}", "{name}経由", "{name} 경유", "via {name}", "через {name}", "через {name}", "经由{name}", "經由{name}"],
  every: ["every {t}", "cada {t}", "toutes les {t}", "{t}ごと", "{t}마다", "a cada {t}", "каждые {t}", "кожні {t}", "每{t}", "每{t}"],
  noProcCd: ["no proc cooldown", "sin enfriamiento de activación", "sans délai de déclenchement", "発動クールダウンなし", "발동 대기시간 없음", "sem recarga de ativação", "без перезарядки срабатывания", "без перезарядки спрацювання", "无触发冷却", "無觸發冷卻"],
  setPieces: ["set · {n} pieces", "conjunto · {n} piezas", "ensemble · {n} pièces", "セット · {n}部位", "세트 · {n}부위", "conjunto · {n} peças", "комплект · {n} предм.", "комплект · {n} предм.", "套装 · {n}件", "套裝 · {n}件"],
  thisItem: ["this item", "este objeto", "cet objet", "このアイテム", "이 아이템", "este item", "этот предмет", "цей предмет", "此物品", "此物品"],
};

let locale = null;      // a resolved locale id, or null for English
let translated = {};    // the picked language's own lang keys

/** Switch language. `lang` is the locale's overlay keys, not the merged lang. */
export function setUiLocale(loc, lang) {
  locale = loc;
  translated = lang || {};
}

/** One UI string in the current language, with {name} holes filled. */
export function t(id, vars) {
  let text = gameWord(id);
  if (text == null) {
    const row = TABLE[id];
    if (!row) return id;
    const col = locale ? L.indexOf(locale) : 0;
    text = (col > 0 && row[col]) || row[0];
  }
  return vars ? text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? "")) : text;
}

function gameWord(id) {
  const key = GAME_KEYS[id];
  const raw = locale && key ? translated[key] : null;
  if (!raw) return null;
  // "Rarity: " and "Tags: " are prefixes in the game, "Cast Time: %1$ss" a
  // sentence - a label wants what stands before the colon. A language that
  // put the number anywhere else would leave a hole, and loses to the table
  const text = raw.replace(/§./g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s*[:：][\s\S]*$/, "").trim();
  return text && !text.includes("%") ? text : null;
}

/** Fill every element that names a UI string in the static page. */
export function applyUi(root = document) {
  for (const el of root.querySelectorAll("[data-t]")) el.textContent = t(el.dataset.t);
  for (const el of root.querySelectorAll("[data-t-title]")) el.title = t(el.dataset.tTitle);
  for (const el of root.querySelectorAll("[data-t-ph]")) el.placeholder = t(el.dataset.tPh);
  for (const el of root.querySelectorAll("[data-t-aria]")) {
    el.setAttribute("aria-label", t(el.dataset.tAria));
  }
}
