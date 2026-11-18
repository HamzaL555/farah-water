-- Farah Water Company
-- A notification is evidence of who moved warehouse stock. `actorName` is
-- already stored, but the relation must not silently drop the author either:
-- removing a user who has notifications should fail, the same way removing one
-- who recorded an inventory movement already does.

ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_actorId_fkey";
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
