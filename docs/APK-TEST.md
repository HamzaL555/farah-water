# APK-nın real cihazda yoxlanması

Bu sənəd hazırlanmış release APK-nın **əsl telefonda** yoxlanması üçün addımları
və iki mərhələli çatdırılma axınının gözlənilən nəticələrini saxlayır.

> **Vacib şərt (bloklayıcı):** APK sabit olaraq
> `https://farah-water.vercel.app/api/v1` ünvanına qoşulur. Həmin ünvanda hələ
> **2 noyabr 2026** build-i işləyir və orada `POST /deliveries/:id/confirm`
> endpointi **yoxdur**. Yəni 6-cı addımdan sonrakı yoxlamalar yalnız yeni backend
> deploy edildikdən sonra keçərli olacaq. Deploy istifadəçi təsdiqi gözləyir
> (bax: [`VERCEL-DEPLOY.md`](./VERCEL-DEPLOY.md)).

## 1. Artefakt

| | |
|---|---|
| Fayl | `release\Farah-1.0.0-release.apk` |
| Ölçü | 58 790 098 bayt (56,1 MiB) |
| SHA-256 | `E82AC36AF197928D6180950C9FB5F0560910F51E38E99C4FBCB18CEFAEC170B4` |
| Paket adı | `az.farah.water` |
| Versiya | `versionCode 1`, `versionName 1.0.0` |
| Etiket | `Farah` |
| minSdk / targetSdk | 24 (Android 7.0) / 36 |
| Memarlıq | `arm64-v8a`, `armeabi-v7a`, `x86`, `x86_64` (hamısı paketdədir) |
| İmza | `CN=Farah Su Sirketi, OU=IT, O=Farah Su Sirketi, L=Baku, C=AZ` |
| Sertifikat SHA-256 | `6f12ac5311e89ca71807095b2dd56063814e1fbfead9939b0ab1477ad754e6fa` |

Köhnə (18.10.2026) build `release\Farah-1.0.0-release-2026-10-18.apk` adı ilə
saxlanılıb — geri qaytarma lazım olsa, həmin fayl istifadə olunur.

## 2. Quraşdırma

### Variant A — ADB ilə (tövsiyə olunur)

Telefonda **Developer options → USB debugging** açılır, telefon kompüterə
qoşulur və:

```powershell
adb devices                       # cihaz "device" kimi görünməlidir
adb install -r "C:\Users\user\Desktop\Farah\release\Farah-1.0.0-release.apk"
```

`-r` mövcud quraşdırmanı saxlayır (məlumat silinmir). Təmiz quraşdırma üçün
əvvəlcə `adb uninstall az.farah.water`.

### Variant B — faylı birbaşa telefona köçürməklə

1. APK-nı kabel, Bluetooth və ya messencerlə telefona göndərin.
2. Telefonda **Settings → Apps → Special access → Install unknown apps**
   bölməsindən fayl menecerinə icazə verin.
3. APK-ya toxunub quraşdırın. Play Protect xəbərdarlıq göstərsə,
   **"Install anyway"** seçin (APK öz açarımızla imzalanıb, Play-dən gəlmir).

### İmzanın cihazda yoxlanması

```powershell
$bt = "C:\Users\user\AppData\Local\Android\Sdk\build-tools\36.1.0"
& "$bt\apksigner.bat" verify --print-certs "release\Farah-1.0.0-release.apk"
```

Çıxışdakı `certificate SHA-256 digest` yuxarıdakı dəyərlə üst-üstə düşməlidir.
Fərqlidirsə, fayl dəyişdirilib — quraşdırmayın.

## 3. Şəbəkə

| | |
|---|---|
| API ünvanı | `https://farah-water.vercel.app/api/v1` (kodda sabit) |
| `usesCleartextTraffic` | `false` — release build **yalnız HTTPS** qəbul edir |
| Tələb | Telefonda internet (Wi-Fi və ya mobil data) |

Yerli `http://192.168.x.x:4100` backend-i ilə sınaq **release APK ilə mümkün
deyil**. Lazım olsa:

1. `mobile/src/services/types.ts` faylında `API_BASE_URL`-i yerli ünvana
   dəyişin, `npm run android` (debug build) ilə quraşdırın.
2. Sınaqdan sonra dəyişikliyi **mütləq geri qaytarın** — commit edilməməlidir.

## 4. Hesablar

| Mühit | İstifadəçi | Rol | Qeyd |
|---|---|---|---|
| Canlı | `admin` | ADMIN | parol yalnız sahibdədir |
| Canlı | `hamza` | WORKER | `workerType` NULL → adi işçi |
| Yerli dev | `admin` / `AdminDev2026!` | ADMIN | |
| Yerli dev | `anbartest` / `Test1234` | WAREHOUSE_KEEPER | anbar əməliyyatları |
| Yerli dev | `aditisci` / `Test1234` | REGULAR | yalnız öz balansı |

Canlı sınaq üçün ayrıca **test işçisi** yaratmaq tövsiyə olunur ki, real
balanslar qarışmasın.

## 5. Sınaqdan əvvəl hazırlıq (canlı)

1. Panelə (`/admin`) admin kimi daxil olun.
2. **Qiymətlər** → Filtr və Bulaq üçün real qiymət yazın (miqrasiyadan sonra
   hər ikisi `0.00`-dır).
3. **Anbar** → ən azı 20 bidon Filtr stoku əlavə edin
   (`WAREHOUSE:FILTERED`).
4. Test işçisinə 10 bidon paylayın (paylama anbar stokundan çıxır).
5. İşçinin **Bidonlarım → Mənim balansım → Filtr suyu** dəyərini qeyd edin
   (bundan sonra `B` kimi istinad olunur).

## 6. Yoxlama ssenarisi

Hər addımda nəticəni qeyd edin. `B` — addım 5-də qeyd olunan balans.

| # | Addım | Gözlənilən nəticə |
|---|---|---|
| 1 | İşçi hesabı ilə daxil olun | Ana səhifə açılır, ad göstərilir |
| 2 | **Yeni Çatdırılma** → müştəri, ünvan, 5 bidon Filtr → **Çatdırılmanı yadda saxla** | Detal ekranı açılır; **Təsdiq: gözləyir · stok hələ çıxmayıb** |
| 3 | **Bidonlarım** bölməsinə qayıdın | Filtr balansı **dəyişməyib — B** |
| 4 | Çatdırılma detalına qayıdın → **Təsdiqlə** → təsdiq dialoqunda **Təsdiqlə** | Mesaj: *"Çatdırılma təsdiqləndi. Bidonlar işçinin balansından çıxdı."*; **Təsdiq: Təsdiqləndi · tarix · ad** |
| 5 | **Bidonlarım** | Filtr balansı **B − 5** |
| 6 | Yenidən **Təsdiqlə** düyməsini axtarın / API-yə təkrar sorğu göndərin | Düymə görünmür; təkrar sorğu `200` qaytarır, `meta.duplicate = true`, balans **dəyişmir** |
| 7 | Admin panelində **Çatdırılmalar → Təsdiq gözləyən** filtri | Bu sətir siyahıda **yoxdur** |
| 8 | Eyni işçi ilə yeni çatdırılma yaradın (3 bidon), **təsdiqləməyin** | Balans **dəyişmir**; panelin **Təsdiq gözləyən** filtrində görünür |
| 9 | Admin olaraq həmin sətri **Ləğv et** → səbəb yazın | *"Çatdırılma ləğv edildi."*; balans **dəyişmir** (stok heç çıxmamışdı) |
| 10 | Təsdiqlənmiş çatdırılmanı (addım 4) admin kimi **Ləğv et** | Balans **B**-yə qayıdır (bir dəfə) |
| 11 | Eyni sətri yenidən ləğv etməyə çalışın | `200`, balans **dəyişmir** (ikinci qaytarma yoxdur) |
| 12 | **Tarixçə** / panelin **Audit** bölməsi | `delivery.confirmed` və `delivery.cancelled` qeydləri görünür |
| 13 | Təsdiqlənməmiş çatdırılmaya ödəniş yazmağa çalışın (API) | `400` — *"… təsdiqlənməmiş …"* |
| 14 | Başqa işçinin çatdırılmasını təsdiqləməyə çalışın | `403` |

### Rədd olunmalı hallar

- **Anbarı aşan paylama** — anbar balansından çox bidon paylamaq `409` verir.
- **Səbəbsiz stok çıxışı** — boş səbəb `422`.
- **Adi işçinin anbar əməliyyatı** — `403`.
- **İki dəfə kliki** — eyni `idempotencyKey` ilə təkrar `POST /deliveries`
  yeni sətir yaratmır.

## 7. API səviyyəsində çarpaz yoxlama

Panel əvəzinə birbaşa API ilə də yoxlamaq olar:

```powershell
$base = "https://farah-water.vercel.app/api/v1"
$login = curl.exe -s -X POST "$base/auth/login" -H "Content-Type: application/json" `
  -d '{"username":"<istifadeci>","password":"<parol>"}' | ConvertFrom-Json
$tok = $login.data.accessToken

# təsdiqlə
curl.exe -s -X POST "$base/deliveries/<id>/confirm" -H "Authorization: Bearer $tok" `
  -H "Content-Type: application/json" -d '{}'

# təkrar təsdiq -> meta.duplicate = true, balans dəyişmir
curl.exe -s -X POST "$base/deliveries/<id>/confirm" -H "Authorization: Bearer $tok" `
  -H "Content-Type: application/json" -d '{}'

# ləğv
curl.exe -s -X POST "$base/deliveries/<id>/cancel" -H "Authorization: Bearer $tok" `
  -H "Content-Type: application/json" -d '{"reason":"test"}'
```

Parolu heç vaxt sənədə, skript faylına və ya loga yazmayın.

## 8. Problem halında

```powershell
adb logcat -c
adb logcat *:E ReactNativeJS:V ReactNative:V | Select-String "Farah|fetch|Network|401|403|409"
```

| Simptom | Səbəb / həll |
|---|---|
| Girişdə "Şəbəkə xətası" | internet yoxdur, ya da backend cavab vermir (`/api/v1/health`) |
| Təsdiq düyməsi görünmür | çatdırılma artıq təsdiqlənib/ləğv edilib, ya da istifadəçi sahibi deyil |
| Təsdiqdə `404` | canlı backend hələ köhnə build-dir → deploy tələb olunur |
| Təsdiqdə `409` | işçinin balansı çatmır (əvvəlcə paylama edin) |
| `Cleartext HTTP not permitted` | release build HTTP qəbul etmir — HTTPS istifadə edin |
| Quraşdırma "App not installed" | köhnə APK fərqli açarla imzalanıb → əvvəlcə `adb uninstall az.farah.water` |

## 9. Nəticənin qeydə alınması

| Tarix | Cihaz / Android | Yoxlayan | Nəticə | Qeyd |
|---|---|---|---|---|
| | | | | |

Sınaq **yalnız** aşağıdakılar tamam olduqda "keçdi" sayılır: addım 2–6, 9–11
və "Rədd olunmalı hallar"ın hamısı gözlənilən nəticəni verir.

## 10. Məlum məhdudiyyətlər

- Release APK yalnız HTTPS ilə işləyir; yerli HTTP backend üçün debug build
  lazımdır.
- APK-da API ünvanını dəyişmək üçün interfeys yoxdur — ünvan kodda sabitdir.
- APK imzalanmışdır, lakin Play Store-a yüklənməyib; paylama əl ilə aparılır.
- `workerType` NULL olan işçi adi işçi sayılır; anbar əməliyyatları üçün panelin
  **İşçilər → Növ** bölməsindən "Anbardar" təyin edilməlidir.
