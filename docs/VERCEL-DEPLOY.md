# Vercel-ə buraxılış runbook-u

Bu sənəd **hazırlığı** təsvir edir. Bu addımlar yerinə yetirilib, lakin
**canlı deploy edilməyib** — istifadəçinin təsdiqi gözlənilir (bax: Bloklayıcı).

## Layihənin faktiki quruluşu

| | |
|---|---|
| Vercel layihəsi | `farah-water` (`prj_3P87Ks7O2lMIE33a0QLukyXwo65S`) |
| Framework | `express` |
| Root directory | repo kökü (`null`) |
| Runtime | Node.js `24.x` |
| Giriş nöqtəsi | `backend/src/main.ts` (`@vercel/node` serverless funksiyası) |
| Statik panel | `backend/public/admin/**` |
| Domen | `https://farah-water.vercel.app` (API: `/api/v1`, panel: `/admin`, işçi: `/isci`) |

Son canlı deployment: **2 noyabr 2026** (`dpl_9L35zZncUazVrvTe1Bw66Lup8DU9`).
Yəni canlı backend hələ təsdiq funksiyası olmayan köhnə build-dir. Baza isə
artıq yeni sxemə keçib — bu, aşağıdakı "Keçid pəncərəsi" bölməsində izah olunur.

## Ön yoxlama nəticələri (19.11.2026)

| Yoxlama | Nəticə |
|---|---|
| `backend`: `npm run typecheck` | ✅ təmiz |
| `backend`: `npm run test:unit` | ✅ 49/49 |
| `backend`: `npm run test:integration` | ✅ 145/145 (7 fayl) |
| `mobile`: `npm run tsc` | ✅ təmiz |
| `web`: `node --check web/app.js` | ✅ |
| `web`: `node web/check-panel.js` | ✅ `PANEL OK` |
| `web`: `node web/sync-to-deploy.js` | ✅ `web/` ↔ `backend/public/admin/` eynidir |
| `backend`: `tsc -p tsconfig.build.json` | ✅ |
| `vercel build --prod` | ✅ `Build completed successfully` |

## Tələb olunan mühit dəyişənləri

Bunlar Vercel layihəsində artıq mövcuddur (`vercel pull` ilə yoxlanıldı).
Heç birini loga və ya repoya yazmayın.

| Dəyişən | Qeyd |
|---|---|
| `DATABASE_URL` | Neon pooler URL-i (`sslmode=require`) |
| `JWT_ACCESS_SECRET` | uzun təsadüfi sətir |
| `JWT_REFRESH_SECRET` | ayrı uzun təsadüfi sətir |
| `ACCESS_TOKEN_TTL` | məs. `30m` |
| `REFRESH_TOKEN_TTL_DAYS` | məs. `30` |
| `BCRYPT_ROUNDS` | məs. `12` |
| `TZ_OFFSET_MINUTES` | `240` (Asia/Baku, UTC+4) |
| `CORS_ORIGIN` | `*` və ya dəqiq domen |
| `NODE_ENV` | `production` |

Yoxlama:

```powershell
npx.cmd vercel pull --yes --environment=production
```

## Build

Vercel `builds` konfiqurasiyasından istifadə etdiyi üçün layihə ayarlarındakı
build komandası tətbiq olunmur. Build `@vercel/node` ilə `backend/src/main.ts`-i
paketləyir.

Lokal preflight (deploy etmir):

```powershell
npx.cmd vercel build --prod
```

Nəticə `.vercel/output/` altında yaranır. Bu addım canlı sistemə heç nə
göndərmir.

Faktiki nəticə (19.11.2026, CLI 64.5.0):

```
{
  "status": "ok",
  "outputDir": ".vercel/output",
  "target": "production",
  "message": "Build completed successfully."
}
```

| Artefakt | Nəticə |
|---|---|
| `functions/backend/src/main.ts` | 1 439 fayl, 33 131 986 bayt (Prisma client daxil) |
| `static/backend/public/admin/` | `index.html` (4 076), `app.js` (144 675), `styles.css` (17 637), `manifest.webmanifest`, ikonlar |
| `config.json` | `/api/*` → funksiya, `/admin/*` → statik panel |

> **`.vercelignore` vacibdir.** `mobile/` qovluğunda Gradle/CMake artefaktları
> var; onlar olmadan upload çox böyüyür və rastgələn fayl xətaları verir.
> Repoya əlavə olunmuş `.vercelignore` yalnız `backend/` və
> `backend/public/admin/`-ı yükləyir. İlk cəhd (`mobile/android/app/.cxx/…`)
> məhz bu səbəbdən `ENOENT` ilə uğursuz olmuşdu; `.vercelignore` əlavə
> edildikdən sonra build təmiz keçdi.

## Deploy (TƏSDİQ TƏLƏB OLUNUR)

```powershell
# 1) prebuilt artefaktı yarat
npx.cmd vercel build --prod

# 2) canlıya burax
npx.cmd vercel deploy --prebuilt --prod
```

Alternativ (prebuilt olmadan): `npx.cmd vercel --prod`.

### Bloklayıcı: plan

Vercel **Hobby** planı kommersiya istifadəsinə icazə vermir. Bu layihə real
müştərilərlə kommersiya sistemidir. Deploy etməzdən əvvəl:

- uyğun **Pro** plana keçin, **və ya**
- yazılı şəkildə Hobby-də qalmağı qəbul edin (risk sizin üzərinizdədir).

Bu sənəd hazırlanarkən **heç bir plan dəyişdirilməyib və deploy edilməyib**.

## Keçid pəncərəsi (köhnə build ↔ yeni baza)

Baza yeni sxemə keçdiyi üçün deploy anında köhnə build bir müddət işləyəcək:

- Köhnə build çatdırılma yaradarkən **stoku dərhal çıxır** və `confirmedAt`
  yazmır.
- Yeni build həmin sətri "təsdiq gözləyir" kimi göstərəcək.
- Yeni build təsdiq edərkən əvvəlcə **`OUT_DELIVERY` ledger qeydinə baxır**:
  stok artıq çıxıbsa, ikinci dəfə çıxmır. Ləğv edərkən də ledger-ə baxıb
  stoku bir dəfə qaytarır.

Yəni keçid pəncərəsində yaranan sətirlər nə ikiqat çıxılır, nə də ikiqat
qaytarılır. Bu davranış `tests/integration/delivery-confirmation.test.ts`
daxilində iki ayrı testlə təsdiqlənib.

## Deploy-dan sonrakı smoke test

```powershell
# 1) API cavab verir
curl.exe -i https://farah-water.vercel.app/api/v1/health

# 2) panel açılır
curl.exe -I https://farah-water.vercel.app/admin

# 3) giriş işləyir (parolu .env-dən götürün, loga yazmayın)
curl.exe -X POST https://farah-water.vercel.app/api/v1/auth/login `
  -H "Content-Type: application/json" `
  -d '{\"username\":\"admin\",\"password\":\"...\"}'
```

Sonra panelə daxil olub yoxlayın:

1. **Çatdırılmalar** — köhnə 3 sətir "Təsdiqlənmiş" görünür.
2. **Təsdiq gözləyən** filtri boş səhv vermir.
3. Yeni çatdırılma yaradın → status "Təsdiq gözləyir", işçi balansı dəyişmir.
4. **Təsdiqlə** → balans azalır; ikinci dəfə basın → dəyişmir.
5. **Ləğv et** → balans qayıdır; ikinci dəfə ləğv → dəyişmir.

## Geri qaytarma

```powershell
npx.cmd vercel ls farah-water          # əvvəlki deployment URL-ini tap
npx.cmd vercel promote <əvvəlki-url>   # və ya dashboard → Promote
```

Baza artıq yeni sxemdədir; köhnə backend additive sütunları görmür və işləməyə
davam edir. Baza səviyyəsində geri qaytarma yalnız son çarədir —
[`PROD-MIGRATION-2026-11-19.md`](./PROD-MIGRATION-2026-11-19.md) bölmə 8-ə baxın.
