# PRD — PlanEat (Meal Planner Italiano)

## Overview
Mobile app Expo Android per pianificare i pasti settimanali, gestire ricette e la lista della spesa. Design warm & welcoming (palette terracotta/cream/sage). UI in italiano.

## Auth
- Email/password (bcrypt + 30-day session token, doppia password in registrazione)
- Password dimenticata via email (codice 6 cifre, 15 min di validità, max 5 tentativi)
- Google OAuth (Emergent-managed)
- Multi-device sync via session token in expo-secure-store

## Tabs (3)
1. **Piatti** — CRUD ricette (Primi/Secondi), search con clear X, duplica piatto, conferma cancellazione
2. **Planner** — Sabato-Venerdì, giorno corrente evidenziato, prev/next selettore settimane, slot Pranzo+Cena con numero persone, duplica settimana da picker personalizzato (qualsiasi settimana passata/futura)
3. **Spesa** — Lista con drag&drop, checkbox, pallini sage/terracotta, force-delete anche di planner items con conferma, gestione tastiera con react-native-keyboard-controller

## Settings
- Backup: export JSON scaricabile via expo-sharing
- Restore: import JSON via expo-document-picker (merge o replace)
- Logout con conferma

## Business logic
- Aggiunta piatto planner → ingredienti × persons ÷ dish_servings sommati alla spesa
- Rimozione piatto planner → sottrazione precisa delle quantità
- Duplica settimana → clona slot + ricalcola spesa

## Endpoints /api/*
- Auth: register, login, forgot-password, reset-password, session (Google), me, logout
- Dishes: CRUD + duplicate (`POST /dishes/{id}/duplicate`)
- Planner: `GET /planner/{week_start}`, `PUT /planner/slot`, `POST /planner/duplicate`, `GET /planner-weeks`
- Shopping: CRUD + reorder + toggle + force-delete + clear-checked
- Backup: `GET /export`, `POST /import` (mode: merge|replace)

## Data (MongoDB)
- users, user_sessions, password_resets (TTL 15min), dishes, weekly_plans, shopping_items

## Icon
Custom generato con PIL: terracotta bg, piatto crema con "PE" serif, forchetta sage top-right, calendario+check bottom-left. Adaptive icon con safe area 66%.

## Email
Emergent Resend, from_name=PlanEat, template italiano con codice a 6 cifre in una box, guardrails G1-G5 attive.
