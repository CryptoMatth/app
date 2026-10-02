# Note: file content below is kept in sync with the Oct 2026 rebrand + UX pack.
# See `/app/memory/PRD.md` for high-level feature list.

#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: |
  PlanEat: Italian meal-planning + grocery mobile app (Expo + FastAPI + MongoDB).
  Continuing user report of two hot issues:
  1. Local notifications (M1) — expiry alerts and freezer alerts are unreliable.
     Multi-day selection only fires the first day; freezer never fires; expiry
     stops mid-day. Notifications are LOCAL only (expo-notifications), no push.
  2. Payment model — user wants Pro+ to switch from one-time (5€) to a
     subscription: 2€/month or 20€/year. Pro remains one-time at 3€.
  Also polish the Italian onboarding/tutorial copy (M8).

backend:
  - task: "Notification preferences save (expiry_enabled, freezer_enabled, freezer_hours, days_ahead, notify_hour)"
    implemented: true
    working: "NA"
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "PUT /api/auth/preferences already accepts the new NotificationPrefs shape. Need to verify each field round-trips correctly and legacy `enabled` fallback still works."

  - task: "RevenueCat sync endpoint accepts Pro+ subscription entitlement"
    implemented: true
    working: "NA"
    file: "backend/server.py, backend/purchases.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Frontend now purchases Pro+ as a SUBSCRIPTION (monthly/annual) via RevenueCat. Backend /purchases/sync should still map the 'pro_plus' entitlement correctly regardless of whether it comes from a lifetime or subscription product."

frontend:
  - task: "Local notification scheduler — multi-day expiries, freezer honoring freezer_hours"
    implemented: true
    working: "NA"
    file: "frontend/src/notifications.ts, frontend/app/(tabs)/_layout.tsx"
    stuck_count: 3
    priority: "high"
    needs_retesting: true
    status_history:
      - working: false
        agent: "user"
        comment: "Multiple days selected → only first fires. Freezer never fires. Expiry stops at some point during the day. Recurring issue across 3 sessions."
      - working: "NA"
        agent: "main"
        comment: "Fixed several bugs: (1) freezer_hours pref was ignored; scheduler now honors 1..168h with per-meal anchor at 13:00/20:00. (2) readNotifPrefs now includes freezer_hours. (3) Concurrent reschedule race: replaced ref-based guard with dirty-flag queue so prefs saves during an in-flight reschedule always trigger a fresh run with latest data. (4) AppState foreground bump throttled to 30s. (5) Verbose console logs added for debug ([notifications] prefix). (6) Effect deps limited to notification fingerprint. (7) Added listPendingPlaneatNotifications() + a diagnostic panel in notifications-expiry screen showing pending notifications. Added RECEIVE_BOOT_COMPLETED to android permissions. NOTE: Local notifications only work on native builds, NOT in Expo Go or web preview — user must test on the deployed .aab."

  - task: "Pro+ subscription pricing UI (monthly 2€ / annual 20€) + Pro one-time 3€"
    implemented: true
    working: "NA"
    file: "frontend/app/settings/plans.tsx, frontend/src/purchases/revenueCat.ts, frontend/src/i18n.ts"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Rewrote plans.tsx: Pro card shows 3€ one-time CTA; Pro+ card shows TWO subscription CTAs side-by-side (Monthly + Annual with 'MIGLIORE' badge) using PackageType.MONTHLY/ANNUAL from RevenueCat. Fallback prices baked in (2€/mese, 20€/anno). Added per-month equivalent for annual. i18n updated in IT + EN. versionCode bumped 132→133."

  - task: "Onboarding tutorial Italian copy polish"
    implemented: true
    working: "NA"
    file: "frontend/src/i18n.ts"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Rewrote all 6 tutorial slides with cleaner Italian grammar and consistent tone («guillemets», full sentences, first-person plural voice for CTAs, updated pricing mentions to reflect the subscription model)."

metadata:
  created_by: "main_agent"
  version: "1.0"
  test_sequence: 1
  run_ui: false

test_plan:
  current_focus:
    - "Notification preferences save (expiry_enabled, freezer_enabled, freezer_hours, days_ahead, notify_hour)"
    - "Local notification scheduler — multi-day expiries, freezer honoring freezer_hours"
    - "Pro+ subscription pricing UI (monthly 2€ / annual 20€) + Pro one-time 3€"
  stuck_tasks:
    - "Local notification scheduler — multi-day expiries, freezer honoring freezer_hours"
  test_all: false
  test_priority: "stuck_first"

agent_communication:
  - agent: "main"
    message: |
      Delegating to testing_agent after implementing three related changes:
      1) Notification scheduler rewrite (see status_history for details).
      2) New subscription-based Pro+ pricing in plans.tsx.
      3) Tutorial Italian copy polish.

      Backend needs to verify preferences round-trip (both legacy + new schema).
      Frontend needs to verify Plans screen renders correctly (Pro card + Pro+
      two-CTA subscription card), tutorial text renders without any missing
      i18n keys.

      NOTE ON NOTIFICATIONS: The scheduler cannot be end-to-end validated in
      web/Expo Go — actual delivery requires a native build. Testing agent
      should verify (a) prefs save/load correctly, (b) the diagnostic panel
      renders and returns 0 pending on web (expected), (c) settings toggles
      wire through to backend, (d) no runtime crashes.

      Credentials in /app/memory/test_credentials.md.
      - Pro+ founder: halley / halley1234
      - Pro: testpro / testPro123
      - Free: create test<timestamp> / pass1234
