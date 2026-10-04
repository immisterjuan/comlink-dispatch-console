# ComLink Refactored Workflow

This document outlines the refactored architecture and logic for ComLink, focusing on the normalized Postgres schema, hybrid state management, and the MDM-style two-step provisioning flow.

## 1. Database Schema (PostgreSQL)

The primary system of record consists of two highly-normalized PostgreSQL tables.

### Table A: `users` (The Registration Allowlist)
Managed entirely by the Admin Console, establishing the identity and permissions of the fleet.
- **`id`**: UUID (Primary Key) — *The secure, unguessable string embedded in the Registration QR code.*
- **`badge_number`**: String (Unique) — *Auto-generated sequential human-readable ID (e.g., 2026-10-04-00001).*
- **`name`**: String (Required) — *e.g., "Unit-Alpha".*
- **`type`**: String (Required, default `person`) — *Tracker icon type.*
- **`tsCreated`**: Timestamp.

### Table B: `connected_users` (Live Telemetry & Status)
Managed by the mobile app sending updates.
- **`userUUID`**: UUID (Primary Key, Foreign Key to `users.id`) — *Links the location data to the allowlisted identity.*
- **`lat`**: String (Required)
- **`lng`**: String (Required)
- **`status`**: String (Nullable, default `null`) — Valid states: `connecting`, `active`, `stop`, `sos`, `idle`, `away`.
- **`tsUpdated`**: Timestamp (Updates automatically via Postgres Trigger on every modification).

> *Note: The `lat` and `lng` columns in Postgres are only updated during significant state transitions (initial connection, stopping, going away, SOS) to prevent overwhelming the database with high-frequency movement ticks.*

## 2. Local Database Sync (SQLite / IndexedDB)
To provide fast offline reads and cache last known locations:
- **Mobile (Expo):** Uses `expo-sqlite` with a local `connected_users` table that stores a flattened result of an inner JOIN between the two Postgres tables. Uses `INSERT ... ON CONFLICT DO UPDATE` to handle single-pass upserts.
- **Console (Web):** Uses `IndexedDB` (implementation handled separately in the console project).

## 3. MDM-Style Provisioning (App Activation)

The app now utilizes a strict, typing-free two-step activation sequence to prevent unauthorized access and eliminate duplicate ghost devices.

1. **Step 1: Event Configuration (`DeviceSetupScreen`)**
   - The user scans the **Event QR Code** (JSON containing `supabase_url`, `supabase_anon_key`, and `supabase_channel`).
   - The app now knows how to communicate with the database, but does not yet know *who* the user is.
2. **Step 2: Device Activation (`RegistrationScreen`)**
   - The user scans their personal **Registration QR Code** (containing just their raw UUID).
   - The app instantly queries the Postgres `users` allowlist using this UUID.
   - If found, it automatically downloads their assigned `name`, `badge_number`, and `type`, saving the UUID to the device.
   - If not found (or if the UUID was revoked/banned via the console), the app rejects the scan and blocks access.
3. **Re-installs & Duplicates:**
   - If a device clears app data, they repeat Steps 1 & 2. Because they scan the same Registration UUID, Postgres natively overwrites their exact `connected_users` row. Zero duplicates.

## 4. Standardized Workflow (Hybrid Architecture)

### Connection Workflow
1. **App Boots:** Checks local storage. If authorized, connects to database.
2. **Upsert Initial State:** Upserts data to `connected_users` using the saved `userUUID` and sets `status = 'connecting'`.
3. **Local Sync:** Fetches all user data from PostgreSQL (via JOIN) and syncs it into the local SQLite database.
4. **GPS Fix:** Initializes map and waits for a GPS fix. Once fixed, upserts the exact position (`lat`, `lng`) and changes `status = 'active'`.
5. **Realtime Broadcast:** Broadcasts the `user-active` command with the current location over Supabase Realtime Broadcast.

### Moving to Stopping Transition
1. **Movement Detected:** The app upserts data to PostgreSQL **once** to set `status = 'active'` and record the starting coordinates.
2. **High-Frequency Telemetry:** While actively moving, the app rapidly streams `user-moving` broadcasts (including `lat`, `lng`) over Supabase Realtime. *These ticks do not hit PostgreSQL.*
3. **Stopping:** As soon as no movement is detected, the app continues sending live positions for a 30-second debounce period. 
4. **Final Anchor:** Once the 30 seconds lapse, it immediately upserts the current final position to PostgreSQL with `status = 'stop'`.
5. **Final Broadcast:** Broadcasts `user-stopped` to trigger other users to write the final location to their local databases.

### Stopping to Moving Transition
1. If movement is detected from a stopped position, repeat the "Moving to Stopping" transition: upserts `status = 'active'` to Postgres, then begins broadcasting `user-moving`.

### SOS Workflow
#### SOS Toggled ON
1. **Upsert:** Immediately upserts the current position to PostgreSQL with `status = 'sos'`.
2. **Continuous Broadcast:** Begins broadcasting the current position in real-time, bypassing normal stationary intervals.
3. **Audio Alert:** Plays a continuous looping siren audio file (`.wav`).
4. **Map UI:** On receiving clients, all other markers are hidden so the user can focus purely on the SOS broadcast. The SOS marker flashes red.

#### SOS Toggled OFF
1. **Stop Audio:** Stops playing the siren audio file.
2. **Upsert:** Upserts the current position to PostgreSQL with `status = 'active'`.
3. **Broadcast:** Broadcasts `user-active` to notify all clients to restore normal map markers.

## 5. Marker Color Guidelines
Based on the `status` received via broadcast or database sync:
- **`active`**: Green (`#4CAF50`)
- **`idle` / `stop`**: Bright Yellow (`#FFEB3B`) - *Applied when stopped for >30s*
- **`away`**: Gray (`#9E9E9E`) - *Applied when stopped/silent for >1 hour*
- **`sos`**: Bright Red (`#F44336`) with flashing animation
