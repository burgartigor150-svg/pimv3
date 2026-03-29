/** Человекочитаемые подписи для типов подключений (единый язык по всему UI). */

export const MARKETPLACE_LABELS: Record<string, string> = {
  ozon: 'Ozon',
  yandex: 'Яндекс Маркет',
  wildberries: 'Wildberries',
  megamarket: 'Мегамаркет',
};

export function marketplaceLabel(type: string | undefined | null): string {
  if (!type) return 'Маркетплейс';
  return MARKETPLACE_LABELS[type] || type;
}

/** Подпись в списках: «Мой магазин — Ozon». */
export function connectionOptionLabel(name: string, type: string): string {
  return `${name} — ${marketplaceLabel(type)}`;
}

export function syndicationStepHint(mpType: string | undefined): string | null {
  if (mpType === 'megamarket') {
    return 'Мегамаркет: нужна категория 6-го уровня — подберите через поиск или вставьте ID.';
  }
  if (mpType === 'yandex') {
    return 'Яндекс Маркет: укажите листовую категорию из каталога Маркета (поиск или ID). В подключении должен быть businessId.';
  }
  if (mpType === 'ozon') {
    return 'Ozon: категория в формате «число_число» (категория + тип), подставляется из поиска.';
  }
  if (mpType === 'wildberries') {
    return 'Wildberries: выберите предмет (subject) из поиска — под него подбираются характеристики.';
  }
  return null;
}
