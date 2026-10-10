# Test və keyfiyyat nəzarəti

## Neçik testlər (DB-siz, tez)

```powershell
cd backend
npm.cmd run test:unit
```

Əhatə olunanlar:

- **Pul arxivikliyi** — `0.10 + 0.20 = 0.30` (float-da `0.30000000000000004` olur),
  `19.99 × 3 = 59.97`, yarı yuxarı yuvarlama.
- **Statusun puldan hesablanması** — 12/20 → `PARTIAL`, 20/20 → `PAID`, 0 → `UNPAID`.
  "Ödənilib" seçmək borcu silmir.
- **Borc** — `max(0, ümumi − ödənilən)`, həddi aşan ödənişdə mənfi olmur.
- **DD.MM.YYYY** — lokal vaxtla (`23:59 UTC` = növbəti gün Bakıda).
- **Vaxt aralıqları** — bu gün / dünən / 7 gün / ay / keçən ay / il.
  Heç bir aralıq `start > end` deyil (regresiya testləri).

## Integration testlər (PostgreSQL lazımdır)

```powershell
docker compose up -d db
cd backend
npm.cmd run test:integration
```

Testlər bir həlli DB-yə eyni vaxtda toxunur, ona görə ardıcıl icra olunur
(`fileParallelism: false`).

| Fayl | Test sayı | Əhatə |
|---|---|---|
| `auth.test.ts` | 20 | login (ad/e-mail/telefon), səhv parol, hesab bloklanması, deaktiv hesab, refresh fırladılması, yalnız hash sağlanması, logout, şifrə dəyişmə, token təhrifəsə, qeydiyyat endpoint-i yoxdur |
| `deliveries.test.ts` | 32 | 10×2.00=20.00, qismən ödəniş (12→8), tam ödəniş, həddi aşma, **təkrar ödənişin bloklanması**, `status=PAID` saxtalamağının uğursuz olması, borc güzəşti gəliri artırmır, void + borcun bərpası, paralel əməliyyat, rol ayrılığı, validasiya |
| `inventory.test.ts` | 22 | qəbul, təhvil, çatdırılmada çıxış, kifayət etmədikdə xəta, **5 paralel çatdırılmada anvar mənfi olmur**, təkrar icra, qaytarma, zədələnmiş/itmiş, jurnal, DB trigger-ləri |
| `reports.test.ts` | 18 | gəlir = faktiki ödəniş (faktura ayrı), keçən borcun bu günə düşməsi, void gəlirdən çıxması, üslub/işçi bölgüsü, CSV (UTF-8 BOM), PDF (Azerbaijani hərfli), süzələmə, sıralama, audit jurnalı |

Cəmi: **42 unit + 92 integration = 134 test**, hamısı keçir.

## DB səviyyəsində müdafiə yoxlaması

Tətbiq səviyyəsindəki yoxlama zəifdirsə belə, bazanın özü saxtalığı rədd edir:

```powershell
cd backend
Get-Content prisma\integrity-verify.sql -Raw |
  docker exec -i farah-postgres psql -U farah -d farah -v ON_ERROR_STOP=0
```

Gözlənilən nəticə — 8 `PASS`:

```
PASS: forged PAID status rejected by deliveries_status_consistent
PASS: debt != total - paid rejected by deliveries_debt_consistent
PASS: total != bottleCount * unitPrice rejected by deliveries_total_consistent
PASS: negative stock rejected by inventory_balances_quantity_non_negative
PASS: DELETE blocked by deliveries_no_delete trigger
PASS: admin deactivation blocked by trigger
PASS: zero payment rejected by payments_amount_positive
PASS: conditional UPDATE matched no rows, so stock cannot go negative
```

Fixture sonunda **ləğv** edilir (silinmir — maliyyə qeydinin silinməsi qadağandır).

## Tip yoxlaması

```powershell
cd backend ; npm.cmd run typecheck     # TypeScript, 0 xəta
cd mobile ; npm.cmd run tsc            # TypeScript, 0 xəta
```

## Bilinən `npm audit` xəbərdarlıqları

**Backend (3 high):** `deepmerge-ts` → `@prisma/config` → `prisma`.
Yalnız **CLI** paketidir (`prisma migrate` / `generate`); server işlədiyi zaman
yüklənmir və uzaqdan hücum oluna bilməz. `npm audit fix` təklif etdiyi "fix"
prisma-6.12-ya endirməkdir, bu da yanlışdır.

**Mobile (32 high):** `@react-native-community/cli` və `@react-native/metro-config`
zənciri (`braces`, `fast-glob` ReDoS). Bunlar `react-native` paketinin öz
asılılığıdır — yalnız **build maşınında** Metro üçün işləyir, APK-nın içindəki
JavaScript kodunda yoxdur. Versiya RN 0.81 ilə bağlıdır.

Hər ikisinin də tətbiqin işləməsinə təsiri yoxdur və "düzəliş" etmək build-i
qırardı.
