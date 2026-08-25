# PRD — PlanEat (Meal Planner Italiano)

## Overview
Mobile app Expo per pianificare i pasti settimanali, gestire ricette e la lista della spesa. Design warm & welcoming (palette terracotta/cream/sage). UI in italiano.

## Auth (username-only, privacy-first)
- Username + password (bcrypt), NO email raccolta
- 12 recovery codes generati alla registrazione (mostrati una sola volta), 8 usabili per reset password
- Rate limit recupero password: 5 tentativi / 15 min per username
- Session token 30 giorni in `expo-secure-store` (AsyncStorage sul web)

## Tabs (3)
1. **Piatti** — CRUD ricette (Primi/Secondi), search con clear X, duplica piatto, conferma cancellazione, note per piatto
2. **Planner** — Sabato-Venerdì, giorno corrente evidenziato, prev/next selettore settimane, slot Pranzo+Cena con numero persone, duplica settimana da picker personalizzato, tasto "Oggi"
3. **Spesa** — Lista con drag&drop, checkbox (spuntati vanno in fondo), pallini sage/terracotta (Planner vs Manuale), force-delete anche di planner items con conferma, note per elemento, pagina full-screen per add/edit

## Onboarding & Tutorial (giu 2026)
- 5 slide di onboarding a scorrimento (Benvenuto → Piatti → Planner → Spesa → Codici recupero)
- Mostrato al primo accesso dopo registrazione, subito dopo la schermata Codici Recupero
- Tip banner contestuali su ogni tab, dismissibili, chiave AsyncStorage `planeat_tip_*`
- Impostazioni → "Rivedi tutorial" resetta i flag e riapre l'onboarding

## Settings
- Modifica username (richiede password attuale), cambia password, rigenera codici recupero
- Backup export/import: `expo-file-system/legacy` + `expo-sharing` (nativo), download via Blob (web); modes merge/replace
- Rivedi tutorial
- Logout con conferma

## Admin (giu 2026)
- Endpoint sotto `/api/admin/*` protetti da header `X-Admin-Password` (variabile env `ADMIN_PASSWORD` in `backend/.env`)
- Operazioni: list users con conteggi, get user detail, reset password (invalida tutte le sessioni dell'utente), delete user (con tutti i suoi dati), stats globali, export JSON completo, export CSV
- **Non c'è UI in-app**: si accede via curl/browser/Postman con header. Password iniziale: `planeat-admin-CH4ngeMe-2026` — da cambiare in `/app/backend/.env`

## Business logic
- Aggiunta piatto planner → ingredienti × persons ÷ dish_servings sommati alla spesa
- Rimozione piatto planner → sottrazione precisa delle quantità
- Duplica settimana → clona slot + ricalcola spesa

## Endpoints /api/*
- Auth: register (ritorna recovery_codes), login, `POST /auth/recovery/verify`, `POST /auth/recovery/regenerate`, `GET /auth/recovery/status`, `PUT /auth/profile`, `PUT /auth/password`, me, logout
- Dishes: CRUD + duplicate
- Planner: `GET /planner/{week_start}`, `PUT /planner/slot`, `POST /planner/duplicate`, `GET /planner-weeks`
- Shopping: CRUD + reorder + toggle + force-delete + clear-checked
- Backup: `GET /export`, `POST /import` (mode: merge|replace)
- Admin: `GET /admin/users`, `GET /admin/users/{id}`, `POST /admin/users/{id}/password`, `DELETE /admin/users/{id}`, `GET /admin/stats`, `GET /admin/export`, `GET /admin/export.csv`

## Data (MongoDB)
- users (con array `recovery_codes` di `{code_hash, used_at}`), user_sessions (TTL su expires_at), dishes, weekly_plans, shopping_items

## Icon
Custom generato con PIL: terracotta bg, piatto crema con "PE" serif, forchetta sage top-right, calendario+check bottom-left. Adaptive icon con safe area 66%.
