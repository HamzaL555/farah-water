# FARAH SU ŞİRKƏTİ — İDARƏETMƏ SİSTEMİ

**React Native (Android APK) + Node.js/Express + PostgreSQL** əsaslı peşəkar mobil idarəetmə sistemi.

İki rol: **ADMIN** (şirkətin tam idarəsi) və **İŞÇİ** (çatdırılma, ödəniş, anbar).
Bütün məlumatlar PostgreSQL-də saxlanılır — APK silinsə belə məlumat **itmir**.

---

## 1. APK NERƏDƏDİR

```
C:\Users\user\Desktop\Farah\release\Farah-1.0.0-release.apk
```

| | |
|---|---|
| Ölçü | 58.7 MB |
| `applicationId` | `az.farah.water` |
| Tətbiq adı | **Farah** |
| `versionName` / `versionCode` | 1.0.0 / 1 |
| `minSdkVersion` | 24 (Android 7.0) |
| `targetSdkVersion` | 36 |
| Arxitektura | arm64-v8a, armeabi-v7a, x86, x86_64 |
| İmza | `CN=Farah Su Sirketi, OU=IT, O=Farah Su Sirketi, L=Baku, C=AZ` |
| SHA-256 (APK) | `DD2FD7E74FA30C2899710119F1617FA598FD61818BA6F6D7E693B135447EDF05` |
| SHA-256 (sertifikat) | `6f12ac5311e89ca71807095b2dd56063814e1fbfead9939b0ab1477ad754e6fa` |
| Build | **release**, `assembleRelease`, JDK 17 + Gradle 8.14.3 |

Quraşdırma: APK-nı telefona köçürün → fayla toxunun → "Quraşdırılışa icazə verin"
(Unknown sources) → quraşdırın.

> ⚠️ APK **server tələb edir**. Onsuz heç nə işləməz — §6 və §7-ə baxın.

---

## 2. VACİB: ƏVVƏLCƏ SERVER QURULMALIDIR

APK müstəqil işləmir; REST API-ə qoşulur.

```
1. Server qurulur        (PostgreSQL + Backend)
2. .env yaradılır        (parollar, secret açarlar)
3. Migration + seed      (iltkin admin hesabı)
4. APK server ünvanına yönləndirilir və yenidən build olunur
5. APK telefon quraşdırılır
```

---

## 3. ARXİTEKTURA

```
┌────────────────────┐        HTTPS (REST/JSON)         ┌──────────────────────┐
│  Android APK       │ ───────────────────────────────► │  Backend (Express 5) │
│  React Native 0.81 │                                  │  Node 22 + TS        │
│  az.farah.water    │ ◄─────────────────────────────── │  port 4000           │
└────────────────────┘      JWT + idempotency key       └──────────┬───────────┘
                                                                    │ Prisma 6
                                                            ┌───────▼────────┐
                                                            │ PostgreSQL 16  │
                                                            │ named volume   │
                                                            └────────────────┘
```

```
Farah/
├── mobile/                   React Native + TypeScript
│   ├── src/
│   │   ├── screens/          19 ekran (Login, Worker*, Admin*, DeliveryDetail...)
│   │   ├── components/       StatCard, StatusChip, DeliveryRow, OfflineBanner...
│   │   ├── navigation/       Rol əsaslı RootNavigator
│   │   ├── services/         api client, endpoints, secureStorage, offlineQueue
│   │   ├── hooks/ context/ utils/ types/ theme/
│   ├── android/              Gradle, keystore, ikonlar
│   └── package.json
├── backend/                  Express 5 + TypeScript
│   ├── src/                  auth users customers deliveries payments debts
│   │                         inventory dashboard reports audit common
│   ├── prisma/
│   │   ├── schema.prisma     12 cədvəl
│   │   ├── migrations/       SQL (integrity constraint + trigger-lər daxil)
│   │   ├── integrity.sql     DB müdafiəsi
│   │   ├── integrity-verify.sql   8 qalxanın yoxlanması
│   │   └── seed.ts
│   ├── assets/fonts/         PDF üçün DejaVu (Azerbaijani hərfləri)
│   └── tests/                42 unit + 92 integration
├── deploy/Caddyfile          HTTPS reverse proxy
├── docs/                     API.md · TESTING.md · backup-restore.sh
├── release/Farah-1.0.0-release.apk
├── docker-compose.yml / .prod.yml / .backup.yml
├── .env.example
└── README.md
```

---

## 4. TEXNOLOGİYALAR

| Qat | Texnologiya | Versiya |
|---|---|---|
| Mobil | React Native (bare) + TypeScript | 0.81.4 |
| UI | React Native Paper (MD3) | 5.15 |
| Naviqasiya | React Navigation 7 | 7.x |
| Təhlükəsiz yaddaş | react-native-keychain (Android Keystore) | 10.x |
| Backend | Express + TypeScript | Node 22 / Express 5.3 |
| ORM | Prisma | 6.19 (son stabil 6.x) |
| DB | PostgreSQL | 16 |
| Validasiya | Zod | 4.x |
| PDF | pdfkit + DejaVu Sans | 0.16 |
| Test | Vitest + Supertest | 5.x / 7.x |

**Qərarlar:** Prisma 7/8 hələ RC-dir → son stabil 6.x seçildi.
`react-native-screens` **4.16.0**-a sabitləndi: 4.29 `React.ComponentRef<>` yazır,
RN 0.81-in codegen isə yalnız `React.ElementRef<>` qəbul edir — build qırılırdı.

---

## 5. BİZNES QAYDALARI (testlərlə təsdiqlənib)

1. Çatdırılma yaradılan kimi borc yaranır.
2. Faktiki ödəniş qeydə alınanda borc azalır.
3. Qismən ödənişdə yalnız ödənilən məbləğ çıxılır.
4. Tam ödənişdə borc sıfır olur.
5. **Status real puldan hesablanır** — "Ödənilib" seçmək borcu silmir.
6. **Gəlir = faktiki ödəniş.** Faktura (çatdırılmış məbləğ) **ayrı** göstərilir.
7. Eyni ödəniş iki dəfə gəlirə daxil edilmir (`idempotencyKey` UNIQUE).
8. Hər əməliyyat tarixçədə saxlanılır.
9. **Maliyə qeydləri silinmir** — DB trigger-i bloklayır; düzəliş = void/adjustment.
10. **Borc güzəşti gəlir sayılmır** — ayrı cədvəl (`debt_adjustments`).
11. **Anbar mənfi ola bilmir** — DB CHECK + atomik UPDATE.
12. Eyni anda 5 paralel çatdırılma test edilib — stok heç vaxt mənfi düşmür.

**Nümunə (10 bidon × 2 AZN):** ümumi 20 → 12 ödəyəndə borc 8, status "Qismən";
8 ödəyəndə borc 0, status "Ödənilib".

---

## 6. SERVER ÜNVANINI APK-DA DƏYİŞMƏK

`mobile\src\services\types.ts`:

```ts
export const API_BASE_URL = 'http://10.0.2.2:4000/api/v1';
```

| Yerləşdirmə | URL |
|---|---|
| Android emulatorda | `http://10.0.2.2:4000/api/v1` |
| Real telefon (Wi-Fi) | `http://192.168.1.XX:4000/api/v1` |
| **Production** | `https://api.sizin-domain.com/api/v1` |

> `localhost` telefonda **telefonu** göstərir, kompüteri deyil.

Kompüterin LAN IP-si:

```powershell
ipconfig | Select-String "IPv4"
```

Production üçün `mobile\android\app\build.gradle` → `release` bölməsinə
`manifestPlaceholders = [usesCleartextTraffic: "false"]` əlavə edin (HTTPS məcburidir).
Dəyişdikdən sonra APK-nı **yenidən qurmalısınız** (2 dəqiqə).

---

## 7. SERVER QURULMASI (WINDOWS)

### Addım 1 — Node.js
<https://nodejs.org> → **LTS**. Yeni PowerShell:

```powershell
node --version
npm.cmd --version
```
> `npm.cmd` yazın, `npm` yox — `npm.ps1` default execution policy ilə bloklanır (normaldır).

### Addım 2 — Docker Desktop
<https://www.docker.com/products/docker-desktop> → quraşdırın və **başladın**.

### Addım 3 — `.env`

```powershell
cd C:\Users\user\Desktop\Farah
Copy-Item .env.example .env
Copy-Item backend\.env.example backend\.env
```

`backend\.env` → `DATABASE_URL` portu `docker-compose.yml` ilə eyni olmalıdır
(default 5432; bu maşında **5436** istifadə olunub):

```ini
DATABASE_URL="postgresql://farah:PAROL@localhost:5436/farah?schema=public"
```

Secret açarlar:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # JWT_ACCESS_SECRET
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # JWT_REFRESH_SECRET
```

### Addım 4 — PostgreSQL

```powershell
docker compose up -d db
docker ps --filter name=farah-postgres      # "healthy" olmalıdır
```

### Addım 5 — Dependencies

```powershell
cd C:\Users\user\Desktop\Farah\backend
npm.cmd install
npx.cmd prisma generate

cd ..\mobile
npm.cmd install
```

### Addım 6 — Migration və ilkin admin

```powershell
cd C:\Users\user\Desktop\Farah\backend
npx.cmd prisma migrate deploy
npm.cmd run seed
```

Seed **bir dəfə** admin istifadəçi adını və şifrəni çap edir — saxlayın.
İlk girişdə dəyişmək tələb olunacaq.

### Addım 7 — Backend

```powershell
npm.cmd run dev        # inkişaf (hot reload)
# və ya
npm.cmd run build && npm.cmd start     # production
```

Yoxlama:

```powershell
curl.exe http://localhost:4000/api/v1/health
# {"data":{"status":"ok",...}}
```

### Addım 8 — Mobil

```powershell
cd C:\Users\user\Desktop\Farah\mobile
npm.cmd start                      # Metro (ayrı terminal)
npm.cmd run build:apk:release      # APK
```

---

## 8. İLK İSTİFADƏ

1. `admin` + seed şifrəsi ilə login.
2. **Profil → Şifrəni dəyiş** (məcburidir).
3. **İşçilər → Yeni işçi** — ad, istifadəçi adı, telefon. Şifrə boş qalsın;
   sistem yaradacaq və **bir dəfə** göstərəcək. İşçiyə təhlükəsiz ötürün.
4. **Anbar → Anbara qəbul** — ilk bidonları daxil edin.
5. **Anbar → İşçiyə təhvil** — hər işçiyə bidon verin.
6. İşçi **Yeni çatdırılma** edir → **Ödəniş əlavə et** → borc azalır.

---

## 9. TESTLƏR

```powershell
cd C:\Users\user\Desktop\Farah\backend
npm.cmd run test:unit          # 42 test, DB-siz
npm.cmd run test:integration   # 92 test, PostgreSQL lazımdır
npm.cmd run test:all
```

**Hamısı keçir (134/134).** Əhatə: login/logout, rol ayrılığı, işçi/müştəri yaratma,
çatdırılma, anbar çıxışı, qismən/tam ödəniş, borc, günlük/aylıq gəlir, təkrar ödənişin
və təkrar inventarın bloklanması, **5 paralel çatdırılma**, saxta `PAID` statusunun
rədd edilməsi, borc güzəşdinin gəliri artırmaması, PDF/CSV, audit jurnalı.

**Canlı API testi** (server işləyərkən) — 19 yoxlama:

```powershell
cd C:\Users\user\Desktop\Farah\backend
node tests\e2e-live.js
```

**DB müdafiəsi** (8 qalxan):

```powershell
Get-Content prisma\integrity-verify.sql -Raw |
  docker exec -i farah-postgres psql -U farah -d farah -v ON_ERROR_STOP=0
```

Detallar: `docs/TESTING.md`.

---

## 10. PRODUCTION

Tələblər: **2 vCPU / 4 GB RAM**, Ubuntu 22.04, Docker, 80/443 açıq, domain.

```bash
cd /opt && git clone <repo> farah && cd farah
cp .env.example .env && nano .env    # parollar, 64-simvol secret-lar
mkdir -p deploy/pgdata backups

docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d db
docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm backend npx prisma migrate deploy
docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm backend npm run seed
# admin şifrəsini dəyişin!

docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile proxy up -d
curl https://api.sizin-domain.com/api/v1/health
```

**HTTPS:** `deploy/Caddyfile` faylında domeni yazın. Caddy Let's Encrypt
sertifikasını **avtomatik** alır. `ufw allow 80,443/tcp` edin.
Production-da PostgreSQL və backend portları **xaricə açılmır**.

Nəticədə `API_BASE_URL`-i HTTPS URL-ə dəyişib APK-nı yenidən qurun.

---

## 11. EHTİYAT VƏ BƏRPA

**Avtomatik** (saatda bir, son 30 dump):

```bash
docker compose -f docker-compose.yml -f docker-compose.backup.yml --profile backup up -d backup
```

**Bərpa** ⚠️ mövcud məlumatı silir:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml stop backend
docker exec farah-postgres psql -U farah -d farah -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
gunzip -c backups/farah-2026-10-09-0300.dump.gz | docker exec -i farah-postgres psql -U farah -d farah
docker compose -f docker-compose.yml -f docker-compose.prod.yml start backend
```

**Server yenidən başlayanda məlumat itmir:** `named volume` (`farah_pgdata`) qalır,
`restart: unless-stopped` ilə konteynerlər özləri qalxır. APK silinsə belə hər şey
serverdən gəlir.

**Ehtiyat götürmədiyiniz ehtiyat ehtiyat deyil** — bərpasını test edin.

---

## 12. TƏHLÜKƏSİZLİK

bcrypt (12 tur) · refresh token yalnız SHA-256 hash · token fırladılması ·
5 cəhdlik bloklama · rate limit · rol yoxlaması hər endpoint-də · Zod validasiya ·
Prisma parametrli sorğular (SQL injection yoxdur) · tokenlar Android Keystore-də ·
bütün admin/maliyə əməliyyatları audit jurnalında · `.env` və keystore `.gitignore`-dadır.

**DB səviyyəsində:** anbar mənfi ola bilmir; borc hər zaman `total − paid`;
status pul ilə ziddiyyət təşkil edə bilmir; maliyyə qeydləri DELETE edilə bilmir;
admin hesabı deaktivləşdirilə bilməz.

---

## 13. OFFLINE REJİM

İnternet olmayanda çatdırılma/ödəniş növbəyə yazılır, aydın bildiriş çıxır.
Bağlantı qaytarılanda avtomatik göndərilir.

**Təkrar yazılmama:** hər əməliyyat klientdə yaradılan UUID (`idempotencyKey`)
daşıyır, bazada UNIQUE. Eyni açar təkrar göndəriləndə server **yeni sətr
yaratmır**, mövcud qeydi qaytarır (`meta.duplicate: true`). Növbə "at least once",
baza "effectively once" təmin edir.

Gözləyən əməliyyatlar: **Profil → Gözləyən əməliyyatlar**.

---

## 14. BİLƏN MƏHDUDİYYƏTLƏR (dürüst qeyd)

1. **PDF/CSV fayl kimi yadda saxlanmır** — paylaşma pəncərəsi (Share) açılır,
   istifadəçi özü seçir. Android fayl yazma icazəsi tələb etməmək üçün qəsdən.
2. **Push bildirişləri yoxdur** — panel hər fokuslananda yenilənir (data canlıdır,
   amma FCM deyil). FCM üçün Firebase konfiqurasiyası lazımdır.
3. **Release APK real fiziki telefonda sınaqdan keçirilməyib.** APK uğurla build və
   imzalandı, paket və imza yoxlanıldı, backend 134 test + 19 canlı test ilə
   sınaqdan keçdi — lakin qurğunuzda fiziki telefon qoşulmadı. Bu, **yeganə
   sınaqdan keçməmiş hissədir.**
4. `npm audit`: backend-də 3, mobile-da 32 xəbərdarlıq — hamısı CLI/Metro
   paketlərində (build maşını), tətbiqin çalışma kodunda deyil.
5. Bir müştərinin eyni ad + ünvanla təkrar qeydi yaranmır (avtomatik birləşir).

---

## 15. TEZ-TEZ SORUŞANLAR

**"Login olmur"** → `curl.exe http://localhost:4000/api/v1/health` yoxlayın;
`.env` dəyişibsə backend-i yenidən başladın; 5 cəhd cəhd edibsə hesab
15 dəqiqə bloklanıb.

**"Serverə qoşulma mümkün olmadı"** → telefon və kompüter eyni Wi-Fi olmalıdır;
`API_BASE_URL` düzgün olmalıdır (§6).

**"Anbar mənfi göstərir"** → mümkün deyil, DB bloklayır. "Kifayət qədər bidon
yoxdur" xətası gəlirsə işçiyə daha çox bidon verin (Anbar → İşçiyə təhvil).

**"Məlumatlar itdi?"** → itmir; APK heç nə saxlamır, hər şey serverdədir.

**"İki telefon eyni məlumatı göstərir?"** → bəli, hər ikisi eyni serverə qoşulur;
fokuslananda ekran özü yenilənir.

**API detalları:** `docs/API.md`
