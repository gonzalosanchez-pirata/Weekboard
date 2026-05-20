const API_BASE = 'http://localhost:3000/api';

const DAY_KEYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

type DayKey = (typeof DAY_KEYS)[number];

const DAY_LABELS: Record<DayKey, string> = {
  monday: 'Lun',
  tuesday: 'Mar',
  wednesday: 'Mié',
  thursday: 'Jue',
  friday: 'Vie',
  saturday: 'Sáb',
  sunday: 'Dom',
};

interface Activity {
  id: number;
  name: string;
  color: string | null;
  days: DayKey[];
}

interface Card {
  id: number;
  activity_id: number;
  week_id: number;
  day: string;
  completed: number;
}

interface CardView extends Card {
  name: string;
  color: string;
}

interface ApiErrorBody {
  error?: string;
}

const appRoot = document.getElementById('app');
if (!appRoot) {
  throw new Error('No se encontró el elemento #app');
}
const appEl: HTMLElement = appRoot;

let currentMonday = getMonday(new Date());
let cards: CardView[] = [];
let loading = false;
let error: string | null = null;

function getMonday(d: Date): Date {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return date;
}

function addDays(d: Date, n: number): Date {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  date.setDate(date.getDate() + n);
  return date;
}

function toWeekParam(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatWeekRange(monday: Date): string {
  const sunday = addDays(monday, 6);
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  const start = monday.toLocaleDateString('es-ES', opts);
  const end = sunday.toLocaleDateString('es-ES', {
    ...opts,
    year: 'numeric',
  });
  return `${start} – ${end}`;
}

function getDateForDay(monday: Date, dayKey: DayKey): Date {
  const index = DAY_KEYS.indexOf(dayKey);
  return addDays(monday, index);
}

function isDayKey(value: string): value is DayKey {
  return (DAY_KEYS as readonly string[]).includes(value);
}

async function parseErrorResponse(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ApiErrorBody;
    if (body.error) {
      return body.error;
    }
  } catch {
    // ignore JSON parse errors
  }
  return `Error HTTP ${response.status}`;
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(await parseErrorResponse(response));
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

async function fetchActivities(): Promise<Activity[]> {
  return apiFetch<Activity[]>(`${API_BASE}/activities`);
}

async function fetchCards(weekStart: string): Promise<Card[]> {
  return apiFetch<Card[]>(`${API_BASE}/cards?week=${encodeURIComponent(weekStart)}`);
}

async function createActivity(
  name: string,
  color: string,
  day: DayKey
): Promise<Activity> {
  return apiFetch<Activity>(`${API_BASE}/activities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, color, days: [day] }),
  });
}

async function createCard(
  activityId: number,
  weekStart: string,
  day: DayKey
): Promise<Card> {
  return apiFetch<Card>(`${API_BASE}/cards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activity_id: activityId, week: weekStart, day }),
  });
}

async function toggleCardComplete(id: number): Promise<{ id: number; completed: number }> {
  return apiFetch<{ id: number; completed: number }>(
    `${API_BASE}/cards/${id}/complete`,
    { method: 'PATCH' }
  );
}

async function deleteCard(id: number): Promise<void> {
  await apiFetch<void>(`${API_BASE}/cards/${id}`, { method: 'DELETE' });
}

function buildCardViews(activities: Activity[], rawCards: Card[]): CardView[] {
  const activityMap = new Map(activities.map((a) => [a.id, a]));
  const views: CardView[] = [];

  for (const card of rawCards) {
    const activity = activityMap.get(card.activity_id);
    if (!activity) {
      console.warn(`Card ${card.id}: actividad ${card.activity_id} no encontrada`);
      continue;
    }
    views.push({
      ...card,
      name: activity.name,
      color: activity.color ?? '#6366f1',
    });
  }

  return views;
}

async function loadWeek(): Promise<void> {
  loading = true;
  error = null;
  render();

  const weekStart = toWeekParam(currentMonday);

  try {
    const [activities, rawCards] = await Promise.all([
      fetchActivities(),
      fetchCards(weekStart),
    ]);
    cards = buildCardViews(activities, rawCards);
  } catch (err) {
    error = err instanceof Error ? err.message : 'Error desconocido';
    cards = [];
  } finally {
    loading = false;
    render();
  }
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) {
    el.className = className;
  }
  if (text !== undefined) {
    el.textContent = text;
  }
  return el;
}

function renderCard(card: CardView): HTMLElement {
  const cardEl = createElement('div', 'card');
  cardEl.dataset.cardId = String(card.id);
  if (card.completed === 1) {
    cardEl.classList.add('card--completed');
  }
  cardEl.style.borderLeftColor = card.color;

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'card__checkbox';
  checkbox.checked = card.completed === 1;
  checkbox.setAttribute('aria-label', `Completar ${card.name}`);

  const nameEl = createElement('span', 'card__name', card.name);

  const deleteBtn = createElement('button', 'card__delete', '×');
  deleteBtn.type = 'button';
  deleteBtn.setAttribute('aria-label', `Eliminar ${card.name}`);

  cardEl.append(checkbox, nameEl, deleteBtn);
  return cardEl;
}

function renderDayColumn(dayKey: DayKey): HTMLElement {
  const column = createElement('div', 'day-column');
  column.dataset.day = dayKey;

  const dayDate = getDateForDay(currentMonday, dayKey);
  const header = createElement('div', 'day-column__header');
  const dayName = createElement(
    'span',
    'day-column__name',
    DAY_LABELS[dayKey]
  );
  const dayNumber = createElement(
    'span',
    'day-column__date',
    String(dayDate.getDate())
  );
  header.append(dayName, dayNumber);

  const cardsContainer = createElement('div', 'day-column__cards');
  const dayCards = cards.filter((c) => c.day === dayKey);
  for (const card of dayCards) {
    cardsContainer.append(renderCard(card));
  }

  const form = document.createElement('form');
  form.className = 'day-column__form';
  form.dataset.day = dayKey;

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'day-column__input-name';
  nameInput.placeholder = 'Nueva actividad';
  nameInput.required = true;

  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.className = 'day-column__input-color';
  colorInput.value = '#6366f1';

  const submitBtn = createElement('button', 'day-column__submit', 'Añadir');
  submitBtn.type = 'submit';

  form.append(nameInput, colorInput, submitBtn);
  column.append(header, cardsContainer, form);
  return column;
}

function render(): void {
  appEl.replaceChildren();

  const root = createElement('div', 'weekboard');

  const header = createElement('header', 'weekboard__header');
  const title = createElement('h1', 'weekboard__title', 'Weekboard');
  const range = createElement('p', 'weekboard__range', formatWeekRange(currentMonday));

  const nav = createElement('nav', 'weekboard__nav');
  const prevBtn = createElement('button', 'weekboard__nav-btn', '← Anterior');
  prevBtn.type = 'button';
  prevBtn.id = 'prev-week';
  const nextBtn = createElement('button', 'weekboard__nav-btn', 'Siguiente →');
  nextBtn.type = 'button';
  nextBtn.id = 'next-week';
  nav.append(prevBtn, nextBtn);

  header.append(title, range, nav);
  root.append(header);

  if (loading) {
    const loadingEl = createElement('p', 'weekboard__loading', 'Cargando…');
    root.append(loadingEl);
  } else {
    const grid = createElement('div', 'weekboard__grid');
    for (const dayKey of DAY_KEYS) {
      grid.append(renderDayColumn(dayKey));
    }
    root.append(grid);
  }

  if (error) {
    const errorEl = createElement('p', 'weekboard__error', error);
    root.append(errorEl);
  }

  appEl.append(root);
}

async function handleCreateCard(dayKey: DayKey, name: string, color: string): Promise<void> {
  const weekStart = toWeekParam(currentMonday);
  const activity = await createActivity(name, color, dayKey);
  await createCard(activity.id, weekStart, dayKey);
  await loadWeek();
}

async function handleToggle(cardId: number): Promise<void> {
  const result = await toggleCardComplete(cardId);
  const card = cards.find((c) => c.id === cardId);
  if (card) {
    card.completed = result.completed;
  }
  render();
}

async function handleDelete(cardId: number): Promise<void> {
  await deleteCard(cardId);
  cards = cards.filter((c) => c.id !== cardId);
  render();
}

appEl.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  if (target.id === 'prev-week') {
    currentMonday = addDays(currentMonday, -7);
    await loadWeek();
    return;
  }

  if (target.id === 'next-week') {
    currentMonday = addDays(currentMonday, 7);
    await loadWeek();
    return;
  }

  if (target.classList.contains('card__delete')) {
    const cardEl = target.closest<HTMLElement>('.card');
    if (!cardEl?.dataset.cardId) {
      return;
    }
    const cardId = Number(cardEl.dataset.cardId);
    error = null;
    try {
      await handleDelete(cardId);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Error al eliminar';
      render();
    }
    return;
  }

  if (target.classList.contains('card__checkbox')) {
    const cardEl = target.closest<HTMLElement>('.card');
    if (!cardEl?.dataset.cardId) {
      return;
    }
    const cardId = Number(cardEl.dataset.cardId);
    error = null;
    try {
      await handleToggle(cardId);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Error al actualizar';
      render();
    }
  }
});

appEl.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !form.classList.contains('day-column__form')) {
    return;
  }

  const day = form.dataset.day;
  if (!day || !isDayKey(day)) {
    return;
  }

  const nameInput = form.querySelector<HTMLInputElement>('.day-column__input-name');
  const colorInput = form.querySelector<HTMLInputElement>('.day-column__input-color');
  if (!nameInput || !colorInput) {
    return;
  }

  const name = nameInput.value.trim();
  if (!name) {
    return;
  }

  error = null;
  try {
    await handleCreateCard(day, name, colorInput.value);
    form.reset();
    colorInput.value = '#6366f1';
  } catch (err) {
    error = err instanceof Error ? err.message : 'Error al crear';
    render();
  }
});

void loadWeek();
