# Changelog

Todos los cambios notables de este proyecto están documentados en este archivo.
El formato sigue [Keep a Changelog](https://keepachangelog.com/es/1.0.0/).

---

## [Unreleased]

### Security — Planning Screen v2 (NO FEAT ABOVE SECURITY)

Auditoría de seguridad sobre la superficie nueva del Sunday Planning Screen v2.
Principio aplicado: **NO FEAT ABOVE SECURITY** — estos fixes tienen prioridad absoluta.

#### [SEC-1] [Media] DELETE /weeks/cards — bloqueo sobre semana planificada
- **Archivo:** `backend/src/routes/weeks.ts` (~línea 199)
- **Problema:** El endpoint aceptaba borrar cards de cualquier semana con formato válido,
  incluyendo semanas ya marcadas como `planned = 1`.
- **Fix:** Se verifica el campo `planned` antes de ejecutar el DELETE. Si `planned = 1`,
  se responde **409 Conflict** y las cards permanecen intactas.
- **Regla de negocio:** Una semana planificada es inmutable por defecto.

#### [SEC-2] [Media] Frontend — "Resetear semana" sin confirmación previa
- **Archivo:** `frontend/src/main.ts` (~línea 1108)
- **Problema:** El handler del botón "Resetear semana" ejecutaba `deleteWeekCards()`
  directamente, sin ninguna confirmación previa ante una acción destructiva e irreversible.
- **Fix:** Se agrega un `<dialog>` nativo de confirmación creado una sola vez dentro de
  `showPlanningMode()`. El botón reset abre el dialog; solo el botón "Sí" del dialog
  ejecuta el borrado. Sin dependencias externas nuevas.
- **CSS:** `frontend/style.css` — nuevas clases `.planning-reset-dialog` y
  `.planning-mode__btn--cancel`.

#### [SEC-3] [Baja] PATCH /weeks/confirm — permitía confirmar semana vacía
- **Archivos:** `backend/src/routes/weeks.ts` (~línea 128), `frontend/src/main.ts`
- **Problema:** El endpoint marcaba `planned = 1` sobre semanas sin cards, cerrando el
  agujero donde "Planificar desde cero" + "Confirmar" sin agregar actividades eludía
  el sistema de 3 strikes del botón de skip.
- **Fix backend:** Se cuenta `COUNT(cards)` antes de confirmar. Si es 0, se responde
  **400 Bad Request** con mensaje descriptivo.
- **Fix frontend:** `confirmBtn` se deshabilita dinámicamente mientras
  `planningCards.length === 0`, con tooltip explicativo. Se habilita automáticamente
  al agregar la primera card (via `syncConfirmBtn()` llamado desde `rebuildGrid()`).

#### [SEC-4] [Baja] validateWeek() — no validaba que la fecha fuera un lunes
- **Archivo:** `backend/src/validation.ts` (línea 69)
- **Problema:** `validateWeek()` aceptaba cualquier fecha válida en formato `YYYY-MM-DD`,
  aunque el modelo de datos asume semanas ancladas al lunes.
- **Fix:** Se agrega `date.getDay() !== 1` como condición de rechazo al final de la
  función. Las fechas que no sean lunes retornan el error:
  `'week debe corresponder a un lunes (inicio de semana)'`.

### Tests
- `backend/src/tests/weeks.test.ts`: 10 tests nuevos/actualizados que cubren todos
  los fixes anteriores. Se agrega `seedCardForWeek()` como helper de precondición.
  - Los 3 tests de `PATCH /weeks/confirm` que confirmaban sin cards fueron actualizados
    para crear una card antes de confirmar.
  - Nuevos tests: `[SEC-1]` DELETE planned=1 → 409, DELETE planned=0 → 200;
    `[SEC-3]` confirm sin cards → 400; `[SEC-4]` fechas no-lunes → 400.
