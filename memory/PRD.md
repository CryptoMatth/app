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

## Settings (giu 2026, riorganizzate in sottopagine)
- Hub `/settings` con card per sezione
- `/settings/account` — modifica username (con password), cambia password, codici recupero
- `/settings/preferences` — inizio settimana (Lun–Dom) + gestione categorie piatti (aggiungi/rinomina/riordina/elimina)
- `/settings/tutorial` — rivedi introduzione e riattiva tip banner
- `/settings/backup` — export/import JSON con modalità merge o replace
- Logout con conferma direttamente dall'hub

## Preferenze utente (giu-ago 2026)
- `week_start_day` (0=Lun..6=Dom, default 5=Sab): il Planner ordina i 7 giorni partendo da qui
- `planner_span` (`weekly` | `biweekly`, default `weekly`): scelta tra 7 giorni o 14 giorni di pianificazione
- `language` (`it` | `en`, default `it`): lingua interfaccia dell'app
- `courses` (lista `{id, label}`): categorie personalizzabili per i piatti; default Primo/Secondo/Contorno/Dolce
- `ingredient_categories` (lista `{id, label, icon, color}`): categorie ingredienti/spesa; default 9 (Verdura, Frutta, Carne/Pesce, Latticini, Pane, Surgelati, Bevande, Dispensa, Altro). Personalizzabili con emoji/colore.
- Il campo `course` sui piatti è ora una stringa libera; l'id viene generato dalla label

## i18n (ago 2026, revisionato ago 2026)
- Sistema minimalista in-house: `useTranslation()` hook con dizionari statici `it` / `en` in `/app/frontend/src/i18n.ts`
- Language cambiabile da Settings → Preferenze
- **Copertura completa**: tutte le schermate (Auth, Onboarding tutorial, tutti e 3 i tab, Dish/Shopping editor, Planner slot picker, tutte le sub-pagine Settings, Recovery codes, Backup) usano `t()` senza stringhe hardcoded
- Helper `tCourse()` / `tCat()`: traducono i label delle categorie/portate di default (`primo`, `verdura`, ecc.) in base all'ID canonico; le categorie custom create dall'utente mantengono il nome originale
- Giorni della settimana localizzati (labels short/full) via `weekStartOptions(lang)` / `orderedDayLabels(startDay, full, lang)`
- Locale date dinamico (`it-IT` vs `en-GB`) per `weekRangeLabel` e visualizzazioni Intl
- Fallback automatico all'italiano per chiavi mancanti

## Spesa raggruppata per categoria (ago 2026)
- Header di sezione con emoji + label per ogni categoria, in ordine deciso dall'utente in Preferenze
- Elementi manuali → categoria selezionata dall'utente al momento dell'aggiunta (default "altro")
- Elementi da Planner → ereditano la `category_id` dell'ingrediente del piatto
- Elementi già presenti in Spesa mantengono la loro categoria (never-overwrite)
- Header separato "Presi" per gli elementi spuntati in fondo
- **Categoria sull'ingrediente del piatto** (ago 2026): quando crei/modifichi un piatto, ogni ingrediente ha un selettore di categoria (modale a lista con emoji). La `category_id` scelta viene salvata sull'ingrediente e propagata automaticamente allo Spesa quando il piatto entra nel Planner.

## Entitlements Pro (giu 2026)
- Campo `entitlements.pro = {active, source, reason, granted_at, revoked_at}` sull'user doc
- Endpoint admin `POST /api/admin/users/{id}/entitlements/pro` (X-Admin-Password required)
- **Founder whitelist**: unico username `halley` → auto-Pro (source: "founder"). Non modificabile da admin (vince sull'admin revoke).
- `/api/auth/me` restituisce `is_pro` + `pro_source` calcolati

## Propagazione modifiche piatto (ago 2026)
- Rinomina piatto → nome aggiornato su tutti gli slot Planner e sui `sources[]` in Spesa
- Cambio ingredienti (rinomina/aggiunta/rimozione ingrediente, cambio quantità, cambio servings) → i contributi in Spesa vengono ricalcolati automaticamente per ogni slot Planner che referenzia quel piatto
- Rimossi solo i contributi del piatto modificato (siblings multi-item nello stesso slot restano intatti)

## Bug fix & UX (giu 2026)
- **Planner slot picker**: tap sul nome del piatto apre i dettagli piatto; solo il pulsante `+` aggiunge alla composizione
- Se un piatto è già nella composizione, tap successivi su `+` **incrementano il numero di persone** invece di duplicarlo
- **Spesa**: dedupe dei nomi piatto ripetuti nella riga (`Pasta, Pasta` → `Pasta`)
- **Rinomina piatto**: propagazione automatica a `weekly_plans.slots.items[]` e `shopping_items.sources[]`
- **Spesa**: pull-to-refresh aggiunto; drag & drop con `activationDistance: 12` per meno lag; conferma prima di "Rimuovi presi"
- **Contatti**: nuova pagina `/settings/contact` con mail crypto.matth719@gmail.com (mailto con oggetto precompilato)
- **Splash screen**: ora usa l'icona PlanEat con testo brand sotto

## Multi-piatto per pasto (giu 2026)
- Ogni slot Pranzo/Cena può contenere N piatti, ciascuno con proprio numero di persone
- Schema DB: `slots[key] = {items: [{dish_id, dish_name, course, persons}, …]}`
- Normalizzazione lazy: gli slot legacy (`{dish_id, ...}` piatti) vengono convertiti a `items[0]` al primo GET
- L'API `PUT /planner/slot` accetta sia la nuova forma (`items: []`) che la vecchia (`dish_id/persons`) per retro-compat
- Ogni item contribuisce indipendentemente alla lista Spesa; rimuovendo un piatto rimuoviamo solo la sua quota

## Admin (giu 2026)
- Endpoint sotto `/api/admin/*` protetti da header `X-Admin-Password` (variabile env `ADMIN_PASSWORD` in `backend/.env`)
- Operazioni: list users con conteggi, get user detail, reset password (invalida tutte le sessioni dell'utente), delete user (con tutti i suoi dati), stats globali, export JSON completo, export CSV
- **Non c'è UI in-app**: si accede via curl/browser/Postman con header. Password iniziale: `planeat-admin-CH4ngeMe-2026` — da cambiare in `/app/backend/.env`

## Business logic
- Aggiunta piatto planner → ingredienti × persons ÷ dish_servings sommati alla spesa
- Rimozione piatto planner → sottrazione precisa delle quantità
- Duplica settimana → clona slot + ricalcola spesa

## Endpoints /api/*
- Auth: register (ritorna recovery_codes), login, `POST /auth/recovery/verify`, `POST /auth/recovery/regenerate`, `GET /auth/recovery/status`, `PUT /auth/profile`, `PUT /auth/password`, `GET/PUT /auth/preferences`, me, logout
- Dishes: CRUD + duplicate
- Planner: `GET /planner/{week_start}`, `PUT /planner/slot`, `POST /planner/duplicate`, `GET /planner-weeks`
- Shopping: CRUD + reorder + toggle + force-delete + clear-checked
- Backup: `GET /export`, `POST /import` (mode: merge|replace)
- Admin: `GET /admin/users`, `GET /admin/users/{id}`, `POST /admin/users/{id}/password`, `DELETE /admin/users/{id}`, `GET /admin/stats`, `GET /admin/export`, `GET /admin/export.csv`

## Data (MongoDB)
- users (con array `recovery_codes` di `{code_hash, used_at}`), user_sessions (TTL su expires_at), dishes, weekly_plans, shopping_items, fridge_items, photos

## AI Suggestions "Cosa cucino?" (giu 2026)
- ~~Endpoint AI rimosso su richiesta utente~~ (consumava credit balance Emergent Universal Key)
- Feature completamente rimossa: nessun endpoint backend, nessuna schermata, nessuna stringa i18n `ai.*`

## Bugfix Batch (giu 2026)
- **B1 Unit picker**: unità di misura ora in bottom sheet modal invece che chip orizzontali (troppi valori). Quantità mostrata in font 18pt bold. Aggiunta `cucchiaino` e `tazza` all'elenco unità.
- **B2 Rename categoria**: `translateDefaultLabel` ora rispetta il label custom dell'utente — se differisce dal default IT, mostra quello. Prima veniva sovrascritto dalla traduzione.
- **B3 Update piatto ↛ auto-add spesa**: `PUT /dishes/{id}` ora chiama `_add_dish_to_shopping(only_update_existing=True)` — propaga modifiche solo se l'ingrediente è GIÀ nella spesa, non aggiunge ingredienti nuovi.
- **B4 Conferma delete ingrediente**: modale `IngredientEditorModal` ora chiede conferma prima di eliminare l'ingrediente dal piatto.
- **A1 Icone corso**: nuovo helper `iconForCourse(courseId, label)` mappa `primo→align-justify`, `secondo→award`, `contorno→feather`, `dolce→gift`, con fallback intelligenti su label EN/IT. La foto piatto se caricata sostituisce comunque l'icona.
- **A2 Rimuovi presi → scelta**: modale ora ha 3 pulsanti: `Sposta nel Frigorifero` / `Elimina soltanto` / Annulla. Backend `POST /shopping/clear-checked?to_fridge=true|false`.
- **A3 Planner sync spesa**: modifica `PUT /planner/slot` accetta `sync_shopping: boolean` (default true). Frontend `planner-slot.tsx` mostra un prompt "Aggiornare la lista Spesa?" al Salva se i piatti sono cambiati. Se non ci sono modifiche, salta il prompt.
- **A4 Lightbox foto**: tap su qualsiasi foto (piatti, ingredienti, spesa, frigo) apre modale a schermo intero con pulsanti `Cambia foto` + `Rimuovi`. Nuovo componente `PhotoLightboxThumb` per uso read-only.
- **Tutorial aggiornato**: slide s3 e s4 riflettono i nuovi prompt (Planner e Rimuovi presi). Traduzioni EN aggiornate simmetricamente.
- Prezzo comunicato: **2€ una tantum** (non ricorrente)
- Feature Pro elencate ovunque: Foto piatti/ingredienti, Frigorifero, Notifiche scadenza, Alert surgelati, Backup Google Drive
- **Settings hub** mostra card Pro-status in cima: "Sei un utente Pro ⭐" (Pro) o "Versione Free · Passa a Pro (2€)" cliccabile (Free)
- **ProUpsellModal** ora scrollabile completamente (schermi piccoli/notch), badge prezzo `2€ una tantum`, aggiunta feature "Frigorifero" nell'elenco
- Frigorifero **lock screen** wrappato in `ScrollView` con `flexGrow:1` così anche il testo lungo è scorribile; auto-apertura modale disabilitata
- Tutorial ora 7 slide: benvenuto, piatti, planner, spesa, **Frigorifero (marcato Pro €2)**, ultimo consiglio recovery, **PlanEat Pro (elenco completo funzionalità sbloccabili)**
- Ogni slide del tutorial ora ha `ScrollView` interno per gestire contenuti lunghi su schermi piccoli

## Icon
Custom generato con PIL: terracotta bg, piatto crema con "PE" serif, forchetta sage top-right, calendario+check bottom-left. Adaptive icon con safe area 66%.
