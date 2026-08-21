# PRD — Cucina di Casa (Meal Planner Italiano)

## Overview
Mobile app (Expo/React Native, Android-first) per pianificare i pasti settimanali, gestire ricette e la lista della spesa in modo automatico. Design "warm & welcoming" con palette terracotta/cream/sage. Testi in italiano.

## Auth
- Email/password (bcrypt + 30-day session token)
- Google OAuth (Emergent-managed) - `/api/auth/session` scambio one-shot
- Sessioni multi-device: token stored via `expo-secure-store` (mobile) / `localStorage` (web)

## Tabs (3)
1. **Piatti** — CRUD ricette diviso in Primi/Secondi con search
2. **Planner** — settimana da Sabato a Venerdì, selettore settimane prev/next, giorno corrente evidenziato, slot Pranzo+Cena con numero persone, tasto "Duplica settimana precedente"
3. **Spesa** — lista ingredienti con drag-to-reorder, checkbox "acquistato", pallini colorati (sage=planner, terracotta=manuale), somma automatica quando stessa unità

## Business logic
- Aggiunta piatto a slot planner → ingredienti (× persons ÷ dish_servings) aggiunti alla spesa
- Rimozione piatto dallo slot → sottrazione precisa della quantità originariamente aggiunta
- Duplica settimana → clona slot + ricalcola spesa
- Manual + planner quantità visibili separatamente (es. "500g · 200g planner + 300g manuale")

## Endpoints (`/api/*`)
- `POST /auth/register`, `POST /auth/login`, `POST /auth/session`, `GET /auth/me`, `POST /auth/logout`
- `GET/POST/PUT/DELETE /dishes[/{id}]`, `GET /dishes?course=&q=`
- `GET /planner/{week_start}`, `PUT /planner/slot`, `POST /planner/duplicate`
- `GET /shopping`, `POST /shopping`, `PATCH /shopping/{id}/toggle`, `DELETE /shopping/{id}`, `POST /shopping/reorder`, `POST /shopping/clear-checked`

## Data models (MongoDB)
- `users` (user_id, email, name, picture, password_hash, provider)
- `user_sessions` (session_token, user_id, expires_at TTL)
- `dishes` (id, user_id, name, course, ingredients[], preparation, servings)
- `weekly_plans` (user_id, week_start[YYYY-MM-DD Saturday], slots: {"0_pranzo": {dish_id, ...}})
- `shopping_items` (id, user_id, key, name, unit, manual_qty, planner_qty, sources[], checked, order)

## Deployment notes (per l'utente)
- Test in Expo Go: gratuito
- Build APK: EAS Build (piano free 30 build/mo)
- iOS: fuori scope (utente ha Android)
