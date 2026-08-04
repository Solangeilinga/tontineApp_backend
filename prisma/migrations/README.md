# Migrations Prisma

Ce dossier doit contenir l'historique versionné des migrations SQL — c'est
la source de vérité du schéma en production. Il est maintenant **commité**
(voir `.gitignore`), contrairement à avant.

## ⚠️ Action requise de ta part (une seule fois)

Je n'ai pas pu générer la migration baseline depuis cet environnement
d'audit : la génération de migration nécessite les moteurs Prisma
(`binaries.prisma.sh`), un hôte auquel cet environnement sandboxé n'a pas
accès réseau. Il n'existe donc **aucune migration** dans ce dossier pour
l'instant, et le schéma actuel de ta base (déjà créée via l'ancien
`db push`) n'est pas encore "baselinée".

**À faire une seule fois, depuis ta machine (avec un accès réseau normal) :**

```bash
# 1. Toujours utiliser DIRECT_URL (sans pooler) pour les commandes migrate
cd backend
npx prisma migrate dev --name init
```

Comme ta base de données existe déjà (créée par l'ancien `db push`), Prisma
va détecter l'écart et te proposer de créer une migration de "baseline"
sans rien recréer. Si Prisma refuse (base non vide, historique absent),
utilise la procédure officielle de "baselining" :
<https://www.prisma.io/docs/orm/prisma-migrate/getting-started#baseline-your-production-environment>

```bash
# Marquer la migration comme déjà appliquée sans y toucher :
npx prisma migrate resolve --applied "0_init"
```

Une fois ce dossier peuplé, commite-le (`git add prisma/migrations`) et
utilise ensuite **exclusivement** :

```bash
npx prisma migrate dev --name <description>   # en local, pour créer une nouvelle migration
npm run release                                # = prisma migrate deploy, en déploiement (CI/Render)
```

Ne reviens **jamais** à `prisma db push --accept-data-loss` en production.
