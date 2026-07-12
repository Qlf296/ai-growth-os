-- Phase 1.1 — user-scope read policies (S6 §3: a signed-in user lists THEIR workspaces).
-- Adds a second, equally narrow scope: app.user_id (SET LOCAL, pooler-safe, same discipline as app.workspace_id).
-- A row is visible EITHER through its workspace scope OR because it belongs to the requesting user.

DROP POLICY ws_isolation ON memberships;
CREATE POLICY ws_isolation ON memberships
  USING (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
         OR user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);

DROP POLICY ws_isolation ON workspaces;
CREATE POLICY ws_isolation ON workspaces
  USING (id = NULLIF(current_setting('app.workspace_id', true), '')::uuid
         OR id IN (SELECT workspace_id FROM memberships
                   WHERE user_id = NULLIF(current_setting('app.user_id', true), '')::uuid))
  WITH CHECK (id = NULLIF(current_setting('app.workspace_id', true), '')::uuid);
