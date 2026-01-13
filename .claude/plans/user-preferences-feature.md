# User Preferences Feature Implementation Plan

## Overview
Add user preferences feature with dark mode toggle and notification settings, scoped to individual sessions.

## Decisions Made
- **Preferences scope**: Session-scoped (embedded in session.json)
- **Dark mode approach**: Tailwind `dark:` variant with class toggle on root element
- **Notification settings**: Simple enable/disable toggle for all notifications
- **UI location**: New `/settings` route accessible from Dashboard

---

## Implementation Steps

### Phase 1: Backend Foundation

#### Step 1: Extend Session Type with Preferences
**File**: `shared/types/session.ts`

Add `preferences` field to the Session interface:
```typescript
interface UserPreferences {
  darkMode: boolean;
  notificationsEnabled: boolean;
}

interface Session {
  // ... existing fields
  preferences?: UserPreferences;  // Optional for backward compatibility
}
```

Include default values: `{ darkMode: false, notificationsEnabled: true }`

---

#### Step 2: Add Zod Validation Schema for Preferences
**File**: `server/src/validation/schemas.ts`

```typescript
export const UserPreferencesSchema = z.object({
  darkMode: z.boolean(),
  notificationsEnabled: z.boolean(),
});

export const UpdatePreferencesSchema = z.object({
  darkMode: z.boolean().optional(),
  notificationsEnabled: z.boolean().optional(),
}).refine(data => Object.keys(data).length > 0, {
  message: 'At least one preference must be provided',
});
```

---

#### Step 3: Add API Endpoint for Preferences
**File**: `server/src/app.ts`

Add route:
```typescript
app.patch(
  '/api/sessions/:projectId/:featureId/preferences',
  validate(UpdatePreferencesSchema),
  async (req, res) => {
    // Update session.preferences
    // Broadcast change via EventBroadcaster
    // Return updated preferences
  }
);
```

---

#### Step 4: Add Socket.IO Event for Preference Changes
**File**: `server/src/services/EventBroadcaster.ts`

Add method:
```typescript
preferencesUpdated(session: Session, preferences: UserPreferences): void {
  const room = `${session.projectId}/${session.featureId}`;
  this.io.to(room).emit('preferences.updated', {
    sessionId: session.id,
    preferences,
    timestamp: new Date().toISOString(),
  });
}
```

---

### Phase 2: Frontend Theme System

#### Step 5: Configure Tailwind for Dark Mode
**File**: `client/tailwind.config.js`

```javascript
module.exports = {
  darkMode: 'class',
  // ... existing config
}
```

---

#### Step 6: Create ThemeProvider Component
**File**: `client/src/components/ThemeProvider.tsx`

Component responsibilities:
- Read dark mode preference from session store
- Apply/remove `dark` class on `document.documentElement`
- React to preference changes in real-time
- Wrap application in `App.tsx`

---

#### Step 7: Add Dark Mode Styles to Existing Components

Update these files with `dark:` variants:

| File | Changes |
|------|---------|
| `Dashboard.tsx` | Background (`dark:bg-gray-900`), text (`dark:text-white`), cards |
| `SessionView.tsx` | Main workspace, panels, buttons |
| `NewSession.tsx` | Form inputs, labels, borders |
| `PlanEditor.tsx` | Plan container styling |
| `PlanNode.tsx` | Node backgrounds, status colors |
| `ConversationPanel.tsx` | Message bubbles, timestamps |

---

### Phase 3: Settings UI

#### Step 8: Create Settings Page Component
**File**: `client/src/pages/Settings.tsx`

Features:
- Dark mode toggle switch with immediate preview
- Notifications enable/disable toggle
- Auto-save on change (or explicit Save button)
- Back navigation to Dashboard
- Loading/error states following existing patterns

---

#### Step 9: Add Settings Route
**File**: `client/src/App.tsx` (or router config)

```typescript
<Route path="/settings" element={<Settings />} />
```

---

#### Step 10: Add Settings Link to Dashboard
**File**: `client/src/pages/Dashboard.tsx`

Add settings gear icon button in header that navigates to `/settings`.

---

### Phase 4: State Management & Integration

#### Step 11: Extend Session Store with Preferences Actions
**File**: `client/src/stores/sessionStore.ts`

Add:
```typescript
interface SessionState {
  // ... existing
  updatePreferences: (prefs: Partial<UserPreferences>) => Promise<void>;
}

// Handle 'preferences.updated' socket event in SessionView or App
```

---

#### Step 12: Implement Notification Toggle Logic
**Files**: `client/src/services/socket.ts`, component handlers

- Check `session.preferences.notificationsEnabled` before showing notifications
- Gate browser Notification API calls based on preference
- Still receive socket events, just don't display them visually

---

#### Step 13: Handle Backward Compatibility
**File**: `server/src/services/SessionManager.ts`

When loading sessions without `preferences` field, provide defaults:
```typescript
const session = await this.storage.readJson<Session>(path);
if (session && !session.preferences) {
  session.preferences = {
    darkMode: false,
    notificationsEnabled: true,
  };
}
```

---

### Phase 5: Verification

#### Step 14: Testing and Verification

Manual testing checklist:
- [ ] Dark mode toggle applies/removes `dark` class immediately
- [ ] Dark mode preference persists after page reload
- [ ] Notification toggle suppresses visual notifications when disabled
- [ ] Preferences save to session.json correctly
- [ ] Existing sessions load with default preferences (no errors)
- [ ] Real-time sync: preference change in one tab reflects in another
- [ ] Settings page accessible from Dashboard
- [ ] Back navigation from Settings works correctly

---

## File Summary

### New Files
- `client/src/pages/Settings.tsx`
- `client/src/components/ThemeProvider.tsx`

### Modified Files
- `shared/types/session.ts` - Add UserPreferences interface
- `server/src/validation/schemas.ts` - Add preference schemas
- `server/src/app.ts` - Add preferences endpoint
- `server/src/services/EventBroadcaster.ts` - Add preferences event
- `server/src/services/SessionManager.ts` - Backward compatibility
- `client/tailwind.config.js` - Enable dark mode
- `client/src/App.tsx` - Add settings route, wrap with ThemeProvider
- `client/src/stores/sessionStore.ts` - Add preference actions
- `client/src/pages/Dashboard.tsx` - Add settings link, dark styles
- `client/src/pages/SessionView.tsx` - Dark styles
- `client/src/pages/NewSession.tsx` - Dark styles
- `client/src/components/PlanEditor/PlanEditor.tsx` - Dark styles
- `client/src/components/PlanEditor/PlanNode.tsx` - Dark styles
- `client/src/components/ConversationPanel/ConversationPanel.tsx` - Dark styles

---

## Dependencies
No new npm packages required. Uses existing:
- Tailwind CSS (dark mode built-in)
- Zustand (state management)
- Socket.IO (real-time sync)
- Zod (validation)
