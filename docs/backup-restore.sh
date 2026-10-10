# ---------------------------------------------------------------------------
# BACKUP AND RESTORE - Farah Water Company
# Run these on the SERVER. Adjust the paths if you install elsewhere.
#
#   backup    -> creates a timestamped .dump.gz in BACKUP_DIR
#   restore   -> restores a dump; ALWAYS stops the backend first
# ---------------------------------------------------------------------------

BACKUP_DIR=/var/backups/farah
PGUSER=farah
PGHOST=localhost
PGDATABASE=farah

BACKUP_FILE="$BACKUP_DIR/farah-$(date +%Y%m%d-%H%M%S).dump.gz"

mkdir -p "$BACKUP_DIR"

# ---- full logical backup -------------------------------------------------
# Custom format (-Fc) enables parallel restore and table-level selection.
pg_dump -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" -Fc -f "$BACKUP_FILE"
echo "Backup yaradildi: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"

# ---- retention: keep the 30 most recent full dumps ------------------------
ls -1t "$BACKUP_DIR"/farah-*.dump.gz | tail -n +31 | xargs -r rm --
echo "Ehti-yat saxlamaci temizlendi (son 30 dump saxlanilir)."

# ===========================================================================
# RESTORE
#   1) docker compose stop backend
#   2) gunzip -c farah-YYYYmmdd-HHMMSS.dump.gz | psql -U farah -d farah
#   3) docker compose start backend
#
# WARNING: restoring replaces current data. Take a fresh backup first.
# ===========================================================================

# restore() {
#   FILE="$1"
#   [ -f "$FILE" ] || { echo "Fayl tapilmadi: $FILE"; return 1; }
#   echo "Bu emeliyyat mövcud melumati SILIR. Davam etmek uchun 'yes' yazin:"
#   read -r ans
#   [ "$ans" = "yes" ] || { echo "Ləğv edildi."; return 1; }
#
#   # Clean slate: schema objects are dropped, volumes on the data itself stay.
#   psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE" \
#     -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
#
#   gunzip -c "$FILE" | psql -h "$PGHOST" -U "$PGUSER" -d "$PGDATABASE"
#   echo "Bərpa tamamlandi."
# }
