// Constantes y tipos globales
import { API_BASE } from './config';

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
  duration_seconds: number | null;
  remaining_seconds: number | null;
  timer_running: 0 | 1;
  last_started_at: string | null;
}

interface CardView extends Card {
  name: string;
  color: string;
}

interface ApiErrorBody {
  error?: string;
}

// Inicialización del DOM y estado global
const appRoot = document.getElementById('app');
if (!appRoot) {
  throw new Error('No se encontró el elemento #app');
}
const appEl: HTMLElement = appRoot;

let currentMonday = getMonday(new Date());
let cards: CardView[] = [];
let loading = false;
let error: string | null = null;
let selectedCardId: number | null = null;
let panelOpen = false;
let tickerId: number | null = null;
let notificationsPermissionRequested = false;
let durationEdited = false;

const DEFAULT_DURATION_SECONDS = 3600;
const MIN_DURATION_SECONDS = 1;
/** Máximo 99:59:59 */
const MAX_DURATION_SECONDS = 99 * 3600 + 59 * 60 + 59;

// Auxiliares de fechas
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
  const end = sunday.toLocaleDateString('es-ES', { ...opts, year: 'numeric' });
  return `${start} – ${end}`;
}

function getDateForDay(monday: Date, dayKey: DayKey): Date {
  const index = DAY_KEYS.indexOf(dayKey);
  return addDays(monday, index);
}

function isDayKey(value: string): value is DayKey {
  return (DAY_KEYS as readonly string[]).includes(value);
}

// Gestión de API y comunicación
async function parseErrorResponse(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as ApiErrorBody;
    if (body.error) return body.error;
  } catch {
    // ignore
  }
  return `Error HTTP ${response.status}`;
}

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(await parseErrorResponse(response));
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function fetchActivities(): Promise<Activity[]> {
  return apiFetch<Activity[]>(`${API_BASE}/activities`);
}

async function fetchCards(weekStart: string): Promise<Card[]> {
  return apiFetch<Card[]>(`${API_BASE}/cards?week=${encodeURIComponent(weekStart)}`);
}

async function createActivity(name: string, color: string, day: DayKey): Promise<Activity> {
  return apiFetch<Activity>(`${API_BASE}/activities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, color, days: [day] }),
  });
}

async function createCard(activityId: number, weekStart: string, day: DayKey): Promise<Card> {
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

type CardTimerState = Pick<Card, 'duration_seconds' | 'remaining_seconds' | 'timer_running' | 'last_started_at'>;

async function setCardDuration(cardId: number, durationSeconds: number): Promise<CardTimerState> {
  return apiFetch<CardTimerState>(`${API_BASE}/cards/${cardId}/duration`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ duration_seconds: durationSeconds }),
  });
}

async function startTimer(cardId: number): Promise<CardTimerState> {
  return apiFetch<CardTimerState>(`${API_BASE}/cards/${cardId}/timer/start`, { method: 'PATCH' });
}

async function pauseTimer(cardId: number): Promise<CardTimerState> {
  return apiFetch<CardTimerState>(`${API_BASE}/cards/${cardId}/timer/pause`, { method: 'PATCH' });
}

async function resetTimer(cardId: number): Promise<CardTimerState> {
  return apiFetch<CardTimerState>(`${API_BASE}/cards/${cardId}/timer/reset`, { method: 'PATCH' });
}

// Gestión del estado de la interfaz
function buildCardViews(activities: Activity[], rawCards: Card[]): CardView[] {
  const activityMap = new Map(activities.map((a) => [a.id, a]));
  const views: CardView[] = [];
  for (const card of rawCards) {
    const activity = activityMap.get(card.activity_id);
    if (!activity) {
      console.warn(`Card ${card.id}: actividad ${card.activity_id} no encontrada`);
      continue;
    }
    views.push({ ...card, name: activity.name, color: activity.color ?? '#6366f1' });
  }
  return views;
}

function mergeTimerState(cardId: number, state: CardTimerState): void {
  const card = cards.find((c) => c.id === cardId);
  if (!card) return;
  card.duration_seconds = state.duration_seconds;
  card.remaining_seconds = state.remaining_seconds;
  card.timer_running = state.timer_running;
  card.last_started_at = state.last_started_at;
}

// Auxiliares del cronómetro y cálculo de tiempo
function formatHMS(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function getEffectiveRemaining(card: Card, nowMs: number): number {
  const baseRemaining = card.remaining_seconds ?? 0;
  if (card.timer_running !== 1) return Math.max(0, baseRemaining);
  if (!card.last_started_at) return Math.max(0, baseRemaining);
  const startedMs = new Date(card.last_started_at).getTime();
  if (Number.isNaN(startedMs)) return Math.max(0, baseRemaining);
  const elapsedSeconds = Math.floor((nowMs - startedMs) / 1000);
  return Math.max(0, baseRemaining - elapsedSeconds);
}

function getProgressRatio(card: Card, nowMs: number): number {
  const duration = card.duration_seconds ?? 0;
  if (duration <= 0) return 0;
  const remaining = getEffectiveRemaining(card, nowMs);
  return Math.max(0, Math.min(1, remaining / duration));
}

// Sistema de actualización en tiempo real (Ticker)
function shouldTickerRun(): boolean {
  return cards.some((c) => c.timer_running === 1);
}

function ensureTicker(): void {
  const need = shouldTickerRun();
  if (need && tickerId === null) {
    tickerId = window.setInterval(() => { void onTick(); }, 1000);
  } else if (!need && tickerId !== null) {
    window.clearInterval(tickerId);
    tickerId = null;
  }
}

async function onTick(): Promise<void> {
  const nowMs = Date.now();
  if (selectedCardId !== null) {
    const selected = cards.find((c) => c.id === selectedCardId);
    if (selected && selected.timer_running === 1) {
      const remaining = getEffectiveRemaining(selected, nowMs);
      if (remaining <= 0) {
        try {
          const state = await pauseTimer(selected.id);
          mergeTimerState(selected.id, state);
        } catch (err) {
          error = err instanceof Error ? err.message : 'Error al pausar';
        }
        ensureTicker();
        render();
        notifyTimerFinished(selected.name);
        return;
      }
    }
  }
  
  for (const card of cards) {
    if (card.timer_running === 1 && (card.duration_seconds ?? 0) > 0) {
      const ratio = getProgressRatio(card, nowMs);
      const cardEl = appEl.querySelector(`.card[data-card-id="${card.id}"]`);
      if (cardEl) {
        const bar = cardEl.querySelector('.card__progress-bar');
        if (bar instanceof HTMLElement) {
          bar.style.transform = `scaleX(${ratio})`;
        }
      }
    }
  }

  if (selectedCardId !== null) {
    const selected = cards.find((c) => c.id === selectedCardId);
    if (selected && selected.timer_running === 1) {
      const countdown = appEl.querySelector('#timer-countdown');
      if (countdown) {
        countdown.textContent = formatHMS(getEffectiveRemaining(selected, nowMs));
      }
    }
  }
}

// Notificaciones del sistema
function requestNotificationPermissionOnce(): void {
  if (notificationsPermissionRequested) return;
  notificationsPermissionRequested = true;
  if (!('Notification' in window)) return;
  void Notification.requestPermission();
}

function notifyTimerFinished(activityName: string): void {
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  new Notification('Weekboard', { body: activityName });
}

// Carga inicial y lógica de la semana
async function loadWeek(): Promise<void> {
  loading = true;
  error = null;
  render();
  const weekStart = toWeekParam(currentMonday);
  try {
    const [activities, rawCards] = await Promise.all([fetchActivities(), fetchCards(weekStart)]);
    cards = buildCardViews(activities, rawCards);
  } catch (err) {
    error = err instanceof Error ? err.message : 'Error desconocido';
    cards = [];
  } finally {
    loading = false;
    ensureTicker();
    render();
  }
}

// Generadores de elementos DOM
function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function renderCard(card: CardView, nowMs: number): HTMLElement {
  const cardEl = createElement('div', 'card');
  cardEl.dataset.cardId = String(card.id);
  if (card.completed === 1) cardEl.classList.add('card--completed');
  cardEl.style.borderLeftColor = card.color;

  const showProgress = !panelOpen && card.timer_running === 1 && (card.duration_seconds ?? 0) > 0;
  if (showProgress) {
    const progress = createElement('div', 'card__progress');
    const bar = createElement('div', 'card__progress-bar');
    bar.style.backgroundColor = card.color;
    const ratio = getProgressRatio(card, nowMs);
    bar.style.transform = `scaleX(${ratio})`;
    progress.append(bar);
    cardEl.append(progress);
  }

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

function renderDayColumn(dayKey: DayKey, nowMs: number): HTMLElement {
  const column = createElement('div', 'day-column');
  column.dataset.day = dayKey;

  const dayDate = getDateForDay(currentMonday, dayKey);
  const header = createElement('div', 'day-column__header');
  const dayName = createElement('span', 'day-column__name', DAY_LABELS[dayKey]);
  const dayNumber = createElement('span', 'day-column__date', String(dayDate.getDate()));
  header.append(dayName, dayNumber);

  const cardsContainer = createElement('div', 'day-column__cards');
  const dayCards = cards.filter((c) => c.day === dayKey);
  for (const card of dayCards) {
    cardsContainer.append(renderCard(card, nowMs));
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

function getSelectedCard(): CardView | null {
  if (selectedCardId === null) return null;
  return cards.find((c) => c.id === selectedCardId) ?? null;
}

function renderTimerPanel(nowMs: number): HTMLElement {
  const panel = createElement('aside', 'wb-timer-panel');
  if (panelOpen) panel.classList.add('wb-timer-panel--open');

  const header = createElement('div', 'wb-timer-panel__header');
  const title = createElement('div', 'wb-timer-panel__title', 'Cronómetro');
  const closeBtn = createElement('button', 'wb-timer-panel__close', '×');
  closeBtn.type = 'button';
  closeBtn.id = 'timer-panel-close';
  closeBtn.setAttribute('aria-label', 'Cerrar panel');
  header.append(title, closeBtn);

  const content = createElement('div', 'wb-timer-panel__content');
  const selected = getSelectedCard();

  if (!selected) {
    const empty = createElement('p', 'wb-timer-panel__empty', 'Seleccioná una card');
    content.append(empty);
    panel.append(header, content);
    return panel;
  }

  const accent = createElement('div', 'wb-timer-panel__activity');
  accent.style.borderLeftColor = selected.color;
  const actName = createElement('h2', 'wb-timer-panel__activity-name', selected.name);
  accent.append(actName);

  const countdown = createElement('div', 'wb-timer-panel__countdown');
  countdown.id = 'timer-countdown';

  if (selected.timer_running === 1) {
    countdown.textContent = formatHMS(getEffectiveRemaining(selected, nowMs));
  } else {
    const currentSeconds =
      selected.remaining_seconds ?? selected.duration_seconds ?? DEFAULT_DURATION_SECONDS;
    const initHH = Math.floor(currentSeconds / 3600);
    const initMM = Math.floor((currentSeconds % 3600) / 60);
    const initSS = currentSeconds % 60;

    const timeForm = document.createElement('form');
    timeForm.className = 'wb-timer-panel__time-wrapper';
    timeForm.autocomplete = 'off';
    timeForm.setAttribute('autocomplete', 'off');
    timeForm.addEventListener('submit', (e) => e.preventDefault());

    function makeSegment(id: string, value: number): HTMLInputElement {
      const input = document.createElement('input');
      input.id = id;
      input.className = 'wb-timer-panel__time-segment';
      input.type = 'text';
      input.maxLength = 2;
      input.value = String(value).padStart(2, '0');
      input.setAttribute('inputmode', 'numeric');
      input.setAttribute('pattern', '[0-9]*');
      input.autocomplete = 'off';
      input.setAttribute('autocomplete', 'off');
      input.setAttribute('autocapitalize', 'off');
      input.setAttribute('autocorrect', 'off');
      input.setAttribute('spellcheck', 'false');
      input.setAttribute('aria-autocomplete', 'none');
      input.setAttribute('data-form-type', 'other');
      input.setAttribute('data-lpignore', 'true');
      input.setAttribute('data-1p-ignore', 'true');
      input.name = `wb-timer-${id}-${Date.now()}`;
      return input;
    }

    const hhInput = makeSegment('timer-input-hh', initHH);
    const mmInput = makeSegment('timer-input-mm', initMM);
    const ssInput = makeSegment('timer-input-ss', initSS);

    const sep1 = createElement('span', 'wb-timer-panel__time-sep', ':');
    const sep2 = createElement('span', 'wb-timer-panel__time-sep', ':');

    timeForm.append(hhInput, sep1, mmInput, sep2, ssInput);
    countdown.append(timeForm);
  }

  const actions = createElement('div', 'wb-timer-panel__actions');
  const startPause = createElement(
    'button',
    'wb-timer-panel__btn wb-timer-panel__btn--primary',
    selected.timer_running === 1 ? 'Pausar' : 'Iniciar'
  );
  startPause.type = 'button';
  startPause.id = 'timer-toggle';

  const reset = createElement('button', 'wb-timer-panel__btn', 'Resetear');
  reset.type = 'button';
  reset.id = 'timer-reset';

  actions.append(startPause, reset);
  content.append(accent, countdown, actions);
  panel.append(header, content);
  return panel;
}

function render(): void {
  appEl.replaceChildren();
  const nowMs = Date.now();

  const layout = createElement('div', 'wb-layout');
  layout.append(renderTimerPanel(nowMs));

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
      grid.append(renderDayColumn(dayKey, nowMs));
    }
    root.append(grid);
  }

  if (error) {
    const errorEl = createElement('p', 'weekboard__error', error);
    root.append(errorEl);
  }

  layout.append(root);
  appEl.append(layout);
}

// Handlers de interacción y llamadas a API
async function handleCreateCard(dayKey: DayKey, name: string, color: string): Promise<void> {
  const weekStart = toWeekParam(currentMonday);
  const activity = await createActivity(name, color, dayKey);
  await createCard(activity.id, weekStart, dayKey);
  await loadWeek();
}

async function handleToggle(cardId: number): Promise<void> {
  const result = await toggleCardComplete(cardId);
  const card = cards.find((c) => c.id === cardId);
  if (card) card.completed = result.completed;
  render();
}

async function handleDelete(cardId: number): Promise<void> {
  await deleteCard(cardId);
  cards = cards.filter((c) => c.id !== cardId);
  if (selectedCardId === cardId) {
    selectedCardId = null;
    panelOpen = false;
  }
  ensureTicker();
  render();
}

async function openTimerPanelForCard(cardId: number): Promise<void> {
  selectedCardId = cardId;
  panelOpen = true;
  error = null;
  render();

  const card = cards.find((c) => c.id === cardId);
  if (!card) return;

  if (card.duration_seconds === null) {
    try {
      const state = await setCardDuration(cardId, DEFAULT_DURATION_SECONDS);
      mergeTimerState(cardId, state);
      ensureTicker();
      render();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Error al configurar duración';
      render();
    }
  }
}

function closeTimerPanel(): void {
  panelOpen = false;
  selectedCardId = null;
  render();
}

function getTimerInputSeconds(): number | null {
  const hhEl = appEl.querySelector<HTMLInputElement>('#timer-input-hh');
  const mmEl = appEl.querySelector<HTMLInputElement>('#timer-input-mm');
  const ssEl = appEl.querySelector<HTMLInputElement>('#timer-input-ss');
  if (!hhEl || !mmEl || !ssEl) return null;
  const hh = Math.min(99, Math.max(0, parseInt(hhEl.value || '0', 10)));
  const mm = Math.min(59, Math.max(0, parseInt(mmEl.value || '0', 10)));
  const ss = Math.min(59, Math.max(0, parseInt(ssEl.value || '0', 10)));
  return hh * 3600 + mm * 60 + ss;
}

async function commitTimerDurationFromInputs(force = false): Promise<void> {
  const selected = getSelectedCard();
  if (!selected || selected.timer_running === 1) {
    return;
  }
  if (!force && !durationEdited) {
    return;
  }

  const totalSeconds = getTimerInputSeconds();
  if (totalSeconds === null) {
    return;
  }

  const clamped = Math.max(MIN_DURATION_SECONDS, Math.min(MAX_DURATION_SECONDS, totalSeconds));
  const state = await setCardDuration(selected.id, clamped);
  mergeTimerState(selected.id, state);
  durationEdited = false;
  ensureTicker();
}

// Listeners de eventos y delegación en el DOM
appEl.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

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
    if (!cardEl?.dataset.cardId) return;
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
    if (!cardEl?.dataset.cardId) return;
    const cardId = Number(cardEl.dataset.cardId);
    error = null;
    try {
      await handleToggle(cardId);
    } catch (err) {
      error = err instanceof Error ? err.message : 'Error al actualizar';
      render();
    }
    return;
  }

  if (target.id === 'timer-panel-close') {
    closeTimerPanel();
    return;
  }

  if (target.id === 'timer-toggle') {
    const selected = getSelectedCard();
    if (!selected) return;
    error = null;
    try {
      if (selected.timer_running === 1) {
        const state = await pauseTimer(selected.id);
        mergeTimerState(selected.id, state);
      } else {
        if (durationEdited || selected.duration_seconds === null) {
          await commitTimerDurationFromInputs(selected.duration_seconds === null);
        }
        const updated = getSelectedCard();
        if (!updated) return;
        const state = await startTimer(updated.id);
        mergeTimerState(updated.id, state);
        durationEdited = false;
      }
      ensureTicker();
      render();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Error del cronómetro';
      render();
    }
    return;
  }

  if (target.id === 'timer-reset') {
    const selected = getSelectedCard();
    if (!selected) return;
    error = null;
    try {
      const state = await resetTimer(selected.id);
      mergeTimerState(selected.id, state);
      durationEdited = false;
      ensureTicker();
      render();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Error al resetear';
      render();
    }
    return;
  }

  const cardEl = target.closest<HTMLElement>('.card');
  if (cardEl?.dataset.cardId) {
    const cardId = Number(cardEl.dataset.cardId);
    if (!Number.isNaN(cardId)) {
      await openTimerPanelForCard(cardId);
    }
  }
});

appEl.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || !form.classList.contains('day-column__form')) return;

  const day = form.dataset.day;
  if (!day || !isDayKey(day)) return;

  const nameInput = form.querySelector<HTMLInputElement>('.day-column__input-name');
  const colorInput = form.querySelector<HTMLInputElement>('.day-column__input-color');
  if (!nameInput || !colorInput) return;

  const name = nameInput.value.trim();
  if (!name) return;

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

appEl.addEventListener('keydown', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (!['timer-input-hh', 'timer-input-mm', 'timer-input-ss'].includes(target.id)) return;

  const key = event.key;

  // Incrementar o decrementar con flechas arriba/abajo
  if (key === 'ArrowUp' || key === 'ArrowDown') {
    event.preventDefault();
    let val = parseInt(target.value, 10);
    if (isNaN(val)) val = 0;
    const max = target.id === 'timer-input-hh' ? 99 : 59;
    if (key === 'ArrowUp') {
      val = val + 1 > max ? 0 : val + 1;
    } else {
      val = val - 1 < 0 ? max : val - 1;
    }
    target.value = String(val).padStart(2, '0');
    durationEdited = true;
    target.select();
    return;
  }

  if (key === 'Enter') {
    event.preventDefault();
    error = null;
    void commitTimerDurationFromInputs()
      .then(() => render())
      .catch((err) => {
        error = err instanceof Error ? err.message : 'Error al configurar duración';
        render();
      });
    return;
  }

  // Retroceder al input anterior con Backspace si el cursor está al inicio o el campo está vacío
  if (key === 'Backspace' && (target.value === '' || target.selectionStart === 0)) {
    event.preventDefault();
    if (target.id === 'timer-input-mm') {
      const prev = appEl.querySelector<HTMLInputElement>('#timer-input-hh');
      if (prev) {
        prev.focus();
        prev.select();
      }
    } else if (target.id === 'timer-input-ss') {
      const prev = appEl.querySelector<HTMLInputElement>('#timer-input-mm');
      if (prev) {
        prev.focus();
        prev.select();
      }
    }
    return;
  }

  // Permitir teclas especiales de navegación y borrado
  const isNavKey = [
    'Backspace', 'Delete', 'Tab', 'Enter', 'Escape',
    'ArrowLeft', 'ArrowRight', 'Home', 'End'
  ].includes(key);

  const isModifier = event.ctrlKey || event.metaKey || event.altKey;

  // Bloquear cualquier tecla que no sea un número o tecla permitida
  if (!/^\d$/.test(key) && !isNavKey && !isModifier) {
    event.preventDefault();
  }
});

appEl.addEventListener('input', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (!['timer-input-hh', 'timer-input-mm', 'timer-input-ss'].includes(target.id)) return;

  target.value = target.value.replace(/\D/g, '');
  durationEdited = true;

  // Salto automático al siguiente input al escribir 2 dígitos
  if (target.value.length >= 2) {
    if (target.id === 'timer-input-hh') {
      const next = appEl.querySelector<HTMLInputElement>('#timer-input-mm');
      if (next) {
        next.focus();
        next.select();
      }
    } else if (target.id === 'timer-input-mm') {
      const next = appEl.querySelector<HTMLInputElement>('#timer-input-ss');
      if (next) {
        next.focus();
        next.select();
      }
    }
  }
});

appEl.addEventListener('focusin', (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement && ['timer-input-hh', 'timer-input-mm', 'timer-input-ss'].includes(target.id)) {
    // Autoseleccionar contenido al enfocar
    setTimeout(() => {
      target.select();
    }, 0);
  }
});

appEl.addEventListener('focusout', (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement && ['timer-input-hh', 'timer-input-mm', 'timer-input-ss'].includes(target.id)) {
    let val = parseInt(target.value, 10);
    if (isNaN(val)) val = 0;
    const max = target.id === 'timer-input-hh' ? 99 : 59;
    val = Math.min(max, Math.max(0, val));
    target.value = String(val).padStart(2, '0');

    const wrapper = appEl.querySelector('.wb-timer-panel__time-wrapper');
    window.setTimeout(() => {
      if (wrapper && !wrapper.contains(document.activeElement)) {
        error = null;
        void commitTimerDurationFromInputs()
          .then(() => render())
          .catch((err) => {
            error = err instanceof Error ? err.message : 'Error al configurar duración';
            render();
          });
      }
    }, 0);
  }
});

// Inicialización de la aplicación
requestNotificationPermissionOnce();
void loadWeek();