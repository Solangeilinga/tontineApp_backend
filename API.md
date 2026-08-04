# API MaTontine — Référence des routes

Base URL : `https://<ton-domaine>/api`

## Format des réponses

Toutes les routes renvoient un JSON de cette forme (voir `src/utils/response.js`) :

```json
// Succès
{ "success": true, "message": "...", "data": { } }

// Erreur
{ "success": false, "message": "...", "errors": [ ] }
```

## Authentification

- La plupart des routes exigent un header `Authorization: Bearer <accessToken>`.
- `authenticateTenant` : réservé au compte **gérant**.
- `authenticateUser` : réservé au compte **membre**.
- `authenticateAny` : accepte gérant OU membre.
- Un access token expiré (7 jours) peut être renouvelé via `POST /auth/refresh` (voir plus bas) sans redemander de PIN, tant que le refresh token (30 jours) est encore valide.

## Rate limiting

- Toutes les routes : 100 req / 15 min / IP (`generalLimiter`).
- Demande d'OTP (`*/request-otp`) : 5 req / 10 min / IP (`otpLimiter`).
- Vérification d'OTP (`*/verify`) : 15 req / 10 min / IP (`otpVerifyLimiter`) **+** 5 tentatives max par numéro de téléphone (compteur Redis indépendant, voir `otpService.js`).

---

## 🔑 Auth — `/api/auth`

| Méthode | Route | Auth | Description |
|---|---|---|---|
| POST | `/refresh` | — (refreshToken dans le body) | Renouvelle l'access token |
| **Gérant — Inscription / Connexion** | | | |
| POST | `/tenant/register/request-otp` | — | Envoie un OTP pour créer un compte gérant |
| POST | `/tenant/register/verify` | — | Vérifie l'OTP et crée le compte |
| POST | `/tenant/login/request-otp` | — | Envoie un OTP de connexion |
| POST | `/tenant/login/verify` | — | Vérifie l'OTP, renvoie access + refresh token |
| **Gérant — PIN** | | | |
| GET | `/tenant/pin/status` | Tenant | Le gérant a-t-il déjà défini un PIN ? |
| POST | `/tenant/pin/set` | Tenant | Définit le PIN |
| POST | `/tenant/pin/verify` | Tenant | Vérifie le PIN (changement de PIN, actions sensibles) |
| POST | `/tenant/pin/verify-locked` | — (session verrouillée) | Déverrouille la session via le PIN |
| **Gérant — Profil** | | | |
| GET | `/tenant/me` | Tenant | Profil du gérant connecté |
| PUT | `/tenant/profile` | Tenant | Met à jour le profil |
| POST | `/tenant/phone/request-otp` | Tenant | OTP pour changer de numéro |
| POST | `/tenant/phone/verify` | Tenant | Confirme le changement de numéro |
| POST | `/tenant/account/delete` | Tenant | Supprime (anonymise) le compte |
| **Membre — Rejoindre / Connexion** | | | |
| POST | `/member/join/request-otp` | — | OTP pour rejoindre un groupe via code d'invitation |
| POST | `/member/join/verify` | — | Vérifie l'OTP et rejoint le groupe |
| POST | `/member/login/request-otp` | — | Envoie un OTP de connexion |
| POST | `/member/login/verify` | — | Vérifie l'OTP (peut renvoyer `requiresSelection` si le numéro est membre chez plusieurs gérants) |
| POST | `/member/login/select-space` | — | Finalise la connexion après choix de l'espace/tenant |
| **Membre — PIN** | | | |
| GET | `/member/pin/status` | User | — |
| POST | `/member/pin/set` | User | — |
| POST | `/member/pin/verify` | User | — |
| POST | `/member/pin/verify-locked` | — | — |
| **Membre — Profil** | | | |
| GET | `/member/me` | User | Profil du membre connecté |
| PUT | `/member/profile` | User | Met à jour le profil |
| POST | `/member/phone/request-otp` | User | OTP pour changer de numéro |
| POST | `/member/phone/verify` | User | Confirme le changement de numéro |
| POST | `/member/account/delete` | User | Supprime (anonymise) le compte |

---

## 👥 Groupes — `/api/groups`

| Méthode | Route | Auth | Description |
|---|---|---|---|
| GET | `/dashboard/summary` | Tenant | Résumé du tableau de bord gérant |
| GET | `/member/my-groups` | User | Groupes du membre connecté |
| PATCH | `/contributions/:id/received` | Tenant | Marque une cotisation reçue |
| PATCH | `/contributions/:id/late` | Tenant | Marque une cotisation en retard |
| POST | `/` | Tenant | Crée un groupe |
| GET | `/` | Tenant | **Paginé** (`?page=&pageSize=`, optionnel — sans ces params, renvoie jusqu'à 100 groupes) |
| GET | `/:id` | Tenant | Détail d'un groupe |
| PUT | `/:id` | Tenant | Modifie un groupe |
| PATCH | `/:id/archive` \| `/:id/unarchive` | Tenant | Archive / désarchive |
| GET | `/:groupId/recap` | Tenant | Récap du cycle |
| GET | `/:groupId/activity` | Tenant | Journal d'activité du groupe |
| DELETE | `/:groupId/activity/:id` | Tenant | Masque une entrée d'activité |
| GET | `/:groupId/members` | Tenant | Liste des membres |
| POST | `/:groupId/members` | Tenant | Ajoute un membre |
| PUT | `/:groupId/members/turn-order` | Tenant | Réordonne les tours |
| PUT / DELETE | `/:groupId/members/:userId` | Tenant | Modifie / retire un membre |
| GET | `/:groupId/contributions` | Tenant | **Paginé** (`?page=&pageSize=`, `?status=&cycleId=&roundNumber=`) |
| GET | `/:groupId/contributions/export` | Tenant | Export (CSV/PDF selon implémentation) |
| GET | `/:groupId/turns` | Tenant | Tours du groupe |
| POST | `/:groupId/turns/received` | Tenant | Marque un tour reçu |
| PATCH | `/:groupId/turns/:turnId/reschedule` | Tenant | Replanifie un tour |
| GET | `/:groupId/cycles` | Tenant | Historique des cycles |
| POST | `/:groupId/cycles/start` \| `/:groupId/cycles/close` | Tenant | Démarre / clôture un cycle |
| GET | `/:groupId/audit-log` | Tenant | Journal d'audit du groupe |
| GET | `/:groupId/member/turns` | User | Tours du membre dans ce groupe |
| GET | `/:groupId/member/contributions` | User | Cotisations du membre |
| DELETE | `/:groupId/member/contributions/:id` | User | Masque une cotisation (côté membre) |

---

## 💳 Abonnements — `/api/subscriptions`

| Méthode | Route | Auth | Description |
|---|---|---|---|
| GET | `/plans` | — | Liste des plans disponibles |
| GET | `/operators` | — | Opérateurs Mobile Money supportés |
| POST | `/webhook` | — (signature HMAC SebPay) | Webhook de confirmation de paiement — **ne jamais appeler manuellement** |
| GET | `/me` | Tenant | Abonnement actuel du gérant |
| POST | `/...` (souscription/changement de plan) | Tenant | Voir `src/routes/subscriptions.js` pour le détail des deux routes POST intermédiaires |
| POST | `/reactivate` | Tenant | Réactive un abonnement |

## 🔔 Notifications — `/api/notifications`

| Méthode | Route | Auth | Description |
|---|---|---|---|
| GET | `/` | User | Liste des notifications |
| GET | `/unread-count` | User | Nombre de non-lues |
| PATCH | `/:id/read` \| `/read-all` | User | Marque comme lue(s) |
| PUT | `/fcm-token` | Tenant ou User | Enregistre le token push FCM |
| DELETE | `/:id` | User | Supprime une notification |

## 🌐 Public — `/api/public`

| Méthode | Route | Auth | Description |
|---|---|---|---|
| POST | `/deletion-requests` | — (CORS restreint, voir `CORS_ALLOWED_ORIGINS`) | Formulaire de demande de suppression de compte, utilisable sans avoir l'app installée (exigence Google Play) |

---

*Document généré à partir de la lecture du code au 04/08/2026. À maintenir à jour manuellement, ou migrer vers une génération automatique (ex: `swagger-jsdoc`) si l'API continue de grossir.*
