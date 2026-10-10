# FARAH SU ŞİRKƏTİ — QURULMA VƏ İSTİFADƏ

## APK

```
release\Farah-1.0.0-release.apk
```

**Telefona köçürüb quraşdırın. Digər heç bir fayl lazım deyil.**
Tək fayldır — tətbiq tək başa düşür.

---

## 1. SERVERİ İŞƏ SALIN (hər dəfə)

Server bu kompüterdə işləyir. Kompüter söndürüləndə tətbiq dayanacaq.

İki proqram lazımdır — hər ikisi də artıq quraşdırılıb:

**1) PostgreSQL (Docker)**

```powershell
cd C:\Users\user\Desktop\Farah
docker compose up -d db
```

**2) Backend**

```powershell
cd C:\Users\user\Desktop\Farah\backend
npm.cmd run dev
```

**3) İnternet tuneli** (tətbiqi qlobal şəbəkəyə çıxarır)

```powershell
cd C:\Users\user\Desktop\Farah
tools\cloudflared.exe tunnel --url http://localhost:4000 --no-autoupdate
```

Yeni ünvan yazacaq:

```
https://bəzi-sözler.trycloudflare.com
```

> ⚠️ **Bu ünvan hər yenidən başladıqda dəyişir.** APK köhnə ünvana bağlıdır.
> Dəyişibsə APK-nı yenidən qurmalısınız.

**Sürətli üç addımlıq başlatma skripti:**

```powershell
.\tools\start-server.ps1
```

O, üçünü ardıcıl qaldırır və yeni ünvanı ekrana çap edir.

---

## 2. İLK DAXİL OLMA

```
İstifadəçi adı : admin
Şifrə          : FarahAdmin2026!
```

İlk girişdə şifrəni dəyişmək tələb olunacaq.

**Yadda saxlayın** — bu şifrə `.env` faylındadır.

---

## 3. İLK İŞÇİ

1. Login olun → **Admin panel → İşçilər**
2. **Yeni işçi** → ad, istifadəçi adı, telefon
3. Şifrəni **boş qoyun** → sistem yaradacaq
4. Müvəqqəti şifrə **bir dəfə** göstəriləcək — işçiyə ötürün
5. İşçi ilk daxil olmada şifrəni dəyişəcək

---

## 4. İLK BIDONLAR

1. **Anbar → Anbara qəbul** → say yazın → əlavə edin
2. **Anbar → İşçiyə təhvil** → işçi seçin → say yazın

İşçi indi **Yeni çatdırılma** edə bilər.

---

## 5. DƏYİŞİKLİK LAZIM OLARSA

```powershell
cd C:\Users\user\Desktop\Farah\mobile
npm.cmd run build:apk:release
```

Nəticə: `mobile\android\app\build\outputs\apk\release\app-release.apk`

Köçürüb `release\` qovluğuna atın.

**Tunel ünvanı dəyişibsə**, əvvəlcə `mobile\src\services\types.ts` faylında
`API_BASE_URL` sətrini yeni ünvana dəyişin.

---

## 6. VACİB: KART MƏHDUDİYYƏTİ

Hazırkı həll **pulsuzdur və heç bir hesab tələb etmir**, lakin:

- **Kompüter söndürüləndə tətbiq işləməz.** İşçilər iş zamanı gözləyə bilməz.
- Tunel yenidən başlayanda URL dəyişir → APK yenidən qurulmalıdır.
- Bu **müvəqqəti** həll-dir.

**Daimi həll** — kompüterlə heç bir əlaqəsi olmayan, 24/7 işləyən server:

| Variant | Qiymət | Nə lazımdır |
|---|---|---|
| Vercel + Neon | **pulsuz** | 2 pulsuz qeydiyyat, kart yoxdur |
| Render | ~$7/ay | hesaba kart |
| VPS (Hetzner) | €3.5/ay | kart + hesab |

Hər üçündə də mən eyni şeyi edirəm: kod GitHub-da hazırdır, APK-nı yeni ünvana
yönləndirib qururam. Fərq yalnız ünvanın sabit qalmasıdır.

---

## 7. NƏ VARM?

- 134 avtomatik test keçir (42 unit + 92 integration)
- 8 DB müdafiəsi: anbar mənfi ola bilmir, borc hər zaman doğru,
  maliyyə qeydləri silinmir, saxta "ödənilib" rədd edilir
- Kod: <https://github.com/HamzaL555/farah-water>
