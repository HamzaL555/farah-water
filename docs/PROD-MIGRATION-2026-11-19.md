# Production bazasının miqrasiyası — 19.11.2026

Bu sənəd canlı Neon bazasında aparılan işin **faktiki** nəticələrini saxlayır.
Bütün əməliyyatlar əvvəlcə bərpa edilmiş nüsxədə sınanıb, sonra canlı bazada
tətbiq olunub. Heç bir cədvəl silinməyib, heç bir sətir itirilməyib.

## 1. Backup

| | |
|---|---|
| Fayl | `backups/prod-20261119-134042.dump` (git-ignore) |
| Format | PostgreSQL custom (`pg_dump -Fc`) |
| Ölçü | 61 359 bayt |
| Alət | `postgres:18-alpine` konteynerində `pg_dump 18.7` |
| Baza | Neon `ep-ancient-cell-batkexdw-pooler`, `neondb`, PostgreSQL 18.7 |

Backup istifadəçi adları, telefonlar və ünvanlar daşıdığı üçün repoya
**heç vaxt** əlavə olunmur (`backups/` `.gitignore`-dadır). Onu ayrıca şifrəli
diskdə saxlayın.

## 2. Backup-ın yoxlanması (restore testi)

Backup təmiz `postgres:18-alpine` instansiyasına bərpa edildi və cədvəl
sayları canlı baza ilə müqayisə olundu:

| Cədvəl | Canlı (əvvəl) | Bərpa olunmuş nüsxə |
|---|---:|---:|
| `users` | 2 | 2 |
| `customers` | 3 | 3 |
| `deliveries` | 3 | 3 |
| `payments` | 2 | 2 |
| `inventory_balances` | 2 | 2 |
| `inventory_transactions` | 8 | 8 |
| `audit_logs` | 40 | 40 |
| `_prisma_migrations` | 4 | 4 |

Nəticə: **backup tamdır**.

## 3. Gözlənilməz vəziyyət: 6 pending miqrasiya

Canlı bazada yalnız 4 miqrasiya tətbiq olunmuşdu. `prisma migrate status`
6 miqrasiyanın gözlədiyini göstərdi (əvvəlki fərziyyə yalnız 1 idi):

1. `20261102140000_warehouse_water_type`
2. `20261111100000_inventory_tx_balances`
3. `20261116120000_inventory_immutable_update`
4. `20261116130000_notification_actor_restrict`
5. `20261116190000_deposits_prices_expenses`
6. `20261119120000_delivery_confirmation`

Hər biri yoxlanıldı:

- **Additive** — yeni sütun/cədvəl/tip/indeks; heç bir sütun silinmir.
- Köhnə `WAREHOUSE` / `WORKER:<id>` açarları `:FILTERED` formasına çevrilir,
  miqdar dəyişmir.
- `notifications` cədvəli yaradılır, sonra nullable sütunlar əlavə olunur.
- `deliveries` üçün təsdiq sütunları əlavə olunur və mövcud sətirlər
  `confirmedAt = COALESCE(deliveredAt, createdAt)` ilə tarixi olaraq
  "təsdiqlənmiş" işarələnir (köhnə build stoku yaradılma zamanı çıxarırdı).
- Maliyyə ledger-ləri üçün append-only trigger-lər yalnız `INSERT`-ə icazə verir.

## 4. Dry-run: bərpa olunmuş nüsxədə tam tətbiq

`prisma migrate deploy` bərpa edilmiş nüsxəyə qarşı işə salındı:

```
All migrations have been successfully applied.
```

Yoxlamalar:

- `inventory_balances`: `WAREHOUSE:FILTERED=20`, `WORKER:53a93437…:FILTERED=5`
- `deliveries`: 3/3 sətir `confirmedAt` aldı
- `inventory_transactions.balanceKey`: köhnə açarlar düzgün çevrildi
- `water_prices`: 2 sətir (FILTERED, SPRING), qiymət `0.00`

`prisma migrate diff` yalnız əvvəldən mövcud olan kosmetik fərqləri göstərir
(`waterType` default-u və `notifications.createdAt` tipi). Eyni fərqlər lokal
`farah_dev` bazasında da var, yəni bu, bu sessiyada yaranmayıb və funksiyaya
təsir etmir.

## 5. Canlı bazada tətbiq

```
npx prisma migrate deploy
All migrations have been successfully applied.
```

## 6. Tətbiqdən sonrakı yoxlama (canlı)

| Yoxlama | Nəticə |
|---|---|
| `users / customers / deliveries / payments` | 2 / 3 / 3 / 2 — **dəyişməyib** |
| `inventory_balances / inventory_transactions / audit_logs` | 2 / 8 / 40 — **dəyişməyib** |
| Balans açarları | `WAREHOUSE:FILTERED=20`, `WORKER:53a9…:FILTERED=5` |
| `deliveries.confirmedAt` | 3 / 3 |
| `_prisma_migrations` (uğurlu) | 10 |
| `water_prices` | FILTERED=0.00, SPRING=0.00 |
| `deliveries` yeni sütunlar | `confirmedAt`, `confirmedById`, `confirmationNote` — hamısı var |
| `deliveries_confirmedAt_idx` | mövcuddur |
| `deliveries_confirmedById_fkey` | mövcuddur |

## 7. Bilməli olduğunuz iki şey

1. **Qiymətlər 0.00-dır.** Miqrasiya qiymət uydurmur. Canlıya keçdikdən sonra
   panelin **Qiymətlər** bölməsində Filtr və Bulaq üçün real qiyməti yazın.
   O vaxta qədər çatdırılmalar 0 ₼ görünəcək.
2. **Mövcud işçi `hamza` üçün `workerType` NULL-dır.** Kod NULL-u "adi işçi"
   kimi qəbul edir (anbara giriş yoxdur). Əgər o, anbar əməliyyatları etməlidirsə,
   panelin **İşçilər → Növ** düyməsi ilə "Anbardar" seçin.

## 8. Geri qaytarma planı

Miqrasiyalar additive olduğu üçün geri qaytarma adətən tələb olunmur. Lazım
olarsa:

```powershell
# 1) Köhnə backend-i geri qaytarın (Vercel → əvvəlki deployment → Promote)
# 2) Baza səviyyəsində geri qaytarma yalnız zəruri halda:
docker run --rm -v "${PWD}/backups:/backup" postgres:18-alpine `
  pg_restore --clean --if-exists --no-owner --no-privileges `
  -d "<DATABASE_URL>" "/backup/prod-20261119-134042.dump"
```

`--clean` mövcud obyektləri silir; bu, **son çarədir**. Əvvəlcə Neon-un
point-in-time recovery imkanını yoxlayın.

## 9. Təkrar yoxlama əmrləri

```powershell
cd backend
$line = Get-Content .env | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1
$env:DATABASE_URL = $line.Substring(13).Trim('"').Trim("'")
npx.cmd prisma migrate status      # "Database schema is up to date!"
```
