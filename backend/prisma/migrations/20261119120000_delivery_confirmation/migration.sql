-- ---------------------------------------------------------------------------
-- Iki mərhələli çatdırılma: çatdırılma yaradılanda stok hərəkət ETMİR.
-- Bidonlar yalnız ayrıca təsdiq əməliyyatı zamanı balansdan çıxır; ləğv
-- yalnız təsdiqlənmiş çatdırılmanın stokunu geri qaytarır.
-- ---------------------------------------------------------------------------

ALTER TABLE "deliveries" ADD COLUMN "confirmedAt" TIMESTAMP(3);
ALTER TABLE "deliveries" ADD COLUMN "confirmedById" TEXT;
ALTER TABLE "deliveries" ADD COLUMN "confirmationNote" TEXT;

-- MÖVCUD MƏLUMAT QORUNUR: köhnə sətirlərin stoku hələ də yaradılma zamanı
-- çıxılırdı. Onları "təsdiqlənmiş" kimi işarələyirik ki, yeni axın heç bir
-- tarixi balansı təkrar dəyişməsin və keçmiş ləğvlər ikinci dəfə stok
-- qaytarmasın. `confirmedById` tarixi səbəblə NULL qalır - həmin vaxt ayrıca
-- təsdiq anlayışı yox idi.
UPDATE "deliveries"
   SET "confirmedAt" = COALESCE("deliveredAt", "createdAt")
 WHERE "confirmedAt" IS NULL;

CREATE INDEX "deliveries_confirmedAt_idx" ON "deliveries"("confirmedAt");

ALTER TABLE "deliveries"
  ADD CONSTRAINT "deliveries_confirmedById_fkey"
  FOREIGN KEY ("confirmedById") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
