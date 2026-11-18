# Farah Water Company — REST API

Base URL: `{host}/api/v1` (development: `http://localhost:4000/api/v1`)

Bütün cavablar `{ "data": ... }` zərfində gəlir. Səhvlər:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Məlumatlar düzgün deyil.", "details": { "field": "..." } } }
```

**Autentifikasiya:** `Authorization: Bearer <accessToken>`

Bütün endpoint-lər ( `/auth/login`, `/auth/refresh`, `/health` və `GET /` istisna)
 autentifikasiya tələb edir.

---

## auth

| Metod | Yol | Rol | Qeyd |
|---|---|---|---|
| POST | `/auth/login` | — | `identifier` (username/e-mail/telefon) + `password`. `{data:{user,tokens}}` |
| POST | `/auth/refresh` | — | `{refreshToken}` → yeni token cütü (köhnəsi etibarsız olur) |
| POST | `/auth/logout` | — | Refresh token-i ləğv edir |
| POST | `/auth/logout-all` | hər ikisi | Bütün cihazların sessiyalarını bağlayır |
| GET | `/auth/me` | hər ikisi | Cari istifadəçi |
| POST | `/auth/change-password` | hər ikisi | Köhnə şifrə + `newPassword`. Bütün sessiyalar bağlanır |

## users

| Metod | Yol | Rol |
|---|---|---|
| GET | `/users/me` | hər ikisi |
| PATCH | `/users/me` | hər ikisi |
| GET | `/users` | ADMIN |
| GET | `/users/stats` | ADMIN |
| POST | `/users` | ADMIN |
| GET/PATCH | `/users/:id` | ADMIN (GET özünə aid olanda hər ikisi) |
| POST | `/users/:id/reset-password` | ADMIN |

**Qeyd:** `POST /users` cavabında `temporaryPassword` bir dəfə qaytarılır və
`mustChangePassword=true` qoyulur. **Rol** sahəsi yoxdur — istifadəçi yalnız işçi
yarada bilər. Yeni işçi üçün `workerType` seçilir:

- `WAREHOUSE_KEEPER` — anbardar; anbar əməliyyatlarına girişi var.
- `REGULAR` — adi işçi; yalnız öz bidon balansını görür (default).

`workerType` yalnız ADMIN tərəfindən `PATCH /users/:id` ilə dəyişdirilir.

## customers

`GET /customers` · `POST /customers` · `GET /customers/:id` · `PATCH /customers/:id`

## deliveries

| Metod | Yol | Rol |
|---|---|---|
| GET | `/deliveries` | hər ikisi (işçi yalnız özünün) |
| POST | `/deliveries` | hər ikisi |
| GET | `/deliveries/:id` | sahib və ya ADMIN |
| PATCH | `/deliveries/:id` | ADMIN (`reason` məcburidir) |
| POST | `/deliveries/:id/cancel` | ADMIN (`reason` məcburidir) |

Filtrlər: `workerId` `customerId` `status` `search` `preset` `from` `to` `onlyDebts`
`page` `pageSize` `sortBy` `sortDir`.

> `status` göndərmək **statusu dəyişmir** — status həmişə puldan yenidən hesablanır.

## payments

`GET /payments` · `POST /payments` · `GET /payments/delivery/:id` ·
`POST /payments/:id/void` (ADMIN)

`GET /payments` cavabında `totalAmount` yalnız **void edilməmiş** ödənişlərin cəmidir.
`includeVoided=true` tarixçədə geri qaytarılmışları da göstərir, lakin cəmə daxil etmir.

## debts

`GET /debts` · `GET /debts/summary` · `GET /debts/delivery/:id/adjustments` ·
`POST /debts/adjustments` (ADMIN)

## inventory

Bulaq suyu (`SPRING`) və Filtr suyu (`FILTERED`) hər yerdə **ayrı** balansdır.
`waterType` göndərilməsə `FILTERED` qəbul edilir.

| Metod | Yol | Rol | Qeyd |
|---|---|---|---|
| GET | `/inventory/summary` | ADMIN, anbardar | Anbar və işçilər üzrə ayrı-ayrı saylar |
| GET | `/inventory/my-stock` | hər ikisi | Yalnız öz balansı |
| GET | `/inventory/transactions` | hər ikisi | Adi işçi yalnız öz sətirlərini görür |
| POST | `/inventory/stock-in` | anbardar | `{waterType,bottleCount,note?,idempotencyKey?}` |
| POST | `/inventory/distribute` | ADMIN, anbardar | `{workerId,waterType,bottleCount}` — anbardan işçiyə |
| POST | `/inventory/issue` | anbardar | Anbardan öz əlinə |
| POST | `/inventory/return` | anbardar | `workerId` verilsə həmin işçidən anbara; verilməsə öz əlindən |
| POST | `/inventory/write-off` | anbardar | `{type:DAMAGE\|LOSS,waterType,bottleCount,note}` — səbəb məcburi |
| POST | `/inventory/warehouse-write-off` | anbardar | Anbardan birbaşa çıxarış; səbəb məcburi |
| GET | `/inventory/worker/:id` | ADMIN, anbardar | Bir işçinin ayrı-ayrı balansı |

Tarixçə filtrləri: `type` `waterType` `workerId` `createdById` `deliveryId`
`preset` `from` `to` `page` `pageSize`.

> Hər `InventoryTransaction` sətri dəyişməzdir: bazada `UPDATE` və `DELETE`
> trigger-ləri ilə bloklanır. Səhv əməliyyat **yeni** düzəliş sətri ilə
> düzəldilir; əvvəlki qeyd silinmir. Hər sətirdə `beforeBalance`, `afterBalance`
> və saniyə dəqiqliyi ilə `occurredAt` saxlanılır.

## notifications

| Metod | Yol | Rol |
|---|---|---|
| GET | `/notifications` | ADMIN |
| GET | `/notifications/unread-count` | ADMIN |
| PATCH | `/notifications/:id/read` | ADMIN |
| PATCH | `/notifications/read-all` | ADMIN |

Hər anbar əməliyyatı (qəbul, çıxarış, işçiyə verilmə, çatdırılmada istifadə,
qaytarma, ləğv, düzəliş) administrator üçün bildiriş yaradır: icraçı, əməliyyat
növü, su növü, say, əvvəlki/sonrakı balans və dəqiq vaxt (saniyə ilə).

## dashboard

`GET /dashboard/worker` · `GET /dashboard/admin` (ADMIN) · `GET /dashboard/revenue` (ADMIN)

## reports

`GET /reports?type=<daily|period|worker|customer|inventory|payments|deliveries>&format=<json|csv|pdf>`

`format=csv` → `text/csv` (UTF-8 BOM, `;` ayırıcı).
`format=pdf` → `application/pdf`.

## audit / settings

`GET /audit/logs` (ADMIN) · `GET /audit/settings` · `PATCH /audit/settings` (ADMIN)

---

## Səhvlər

| Kod | HTTP | Səbəb |
|---|---|---|
| `VALIDATION_ERROR` | 422 | Zod uyğun gəlmir |
| `INVALID_CREDENTIALS` | 401 | Yanlış ad/parol |
| `ACCOUNT_LOCKED` | 423 | Çox sayda uğursuz cəhd |
| `UNAUTHORIZED` | 401 | Token yoxdur / etibarsızdır |
| `FORBIDDEN` | 403 | Rol icazəsi yoxdur |
| `DUPLICATE` | 409 | Unikal məhdudiyyət pozulub (təkrar əməliyyat) |
| `INSUFFICIENT_STOCK` | 409 | Kifayət qədər bidon yoxdur |
| `HAS_PAYMENTS` | 409 | Ödəniş alınıb, əvvəlcə void et |
| `RATE_LIMITED` | 429 | Həddi aşılıb |

## İdempotentlik

`POST /deliveries`, `POST /payments`, `POST /inventory/*` — hamısı
`idempotencyKey` qəbul edir (8-100 simvol). Eyni açar təkrar göndəriləndə:

```json
HTTP 200
{ "data": { ... mövcud qeyd ... }, "meta": { "duplicate": true } }
```

İlk yaradılış `HTTP 201` qaytarır. Bu, offline növbənin təkrar yazılmadan
öndənəməsini təmin edir.
