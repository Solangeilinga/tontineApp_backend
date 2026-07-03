// prisma/seed.js
const { PrismaClient } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Début du seeding...');

  // ── Gérant 1
  const gerant1 = await prisma.tenant.upsert({
    where: { phone: '+22670000001' },
    update: {},
    create: {
      id: uuidv4(),
      name: 'Aminata Ouédraogo',
      phone: '+22670000001',
    },
  });

  // ── Gérant 2
  const gerant2 = await prisma.tenant.upsert({
    where: { phone: '+22670000002' },
    update: {},
    create: {
      id: uuidv4(),
      name: 'Moussa Kaboré',
      phone: '+22670000002',
    },
  });

  // ── Membres pour gérant 1
  const membre1 = await prisma.user.upsert({
    where: { tenantId_phone: { tenantId: gerant1.id, phone: '+22670000010' } },
    update: {},
    create: {
      tenantId: gerant1.id,
      name: 'Fatima Sawadogo',
      phone: '+22670000010',
    },
  });

  const membre2 = await prisma.user.upsert({
    where: { tenantId_phone: { tenantId: gerant1.id, phone: '+22670000011' } },
    update: {},
    create: {
      tenantId: gerant1.id,
      name: 'Ibrahim Traoré',
      phone: '+22670000011',
    },
  });

  const membre3 = await prisma.user.upsert({
    where: { tenantId_phone: { tenantId: gerant1.id, phone: '+22670000012' } },
    update: {},
    create: {
      tenantId: gerant1.id,
      name: 'Mariam Diallo',
      phone: '+22670000012',
    },
  });

  // ── Groupe test
  const groupe = await prisma.group.upsert({
    where: { inviteCode: 'TONT001' },
    update: {},
    create: {
      tenantId: gerant1.id,
      name: 'Tontine Mensuelle Famille',
      type: 'MONEY',
      frequency: 'MONTHLY',
      amount: 10000,
      currency: 'XOF',
      description: 'Tontine mensuelle de 10 000 FCFA',
      inviteCode: 'TONT001',
    },
  });

  // ── Membres du groupe
  await prisma.groupMember.upsert({
    where: { groupId_userId: { groupId: groupe.id, userId: membre1.id } },
    update: {},
    create: { groupId: groupe.id, userId: membre1.id, orderTurn: 1 },
  });

  await prisma.groupMember.upsert({
    where: { groupId_userId: { groupId: groupe.id, userId: membre2.id } },
    update: {},
    create: { groupId: groupe.id, userId: membre2.id, orderTurn: 2 },
  });

  await prisma.groupMember.upsert({
    where: { groupId_userId: { groupId: groupe.id, userId: membre3.id } },
    update: {},
    create: { groupId: groupe.id, userId: membre3.id, orderTurn: 3 },
  });

  console.log('✅ Seeding terminé !');
  console.log(`   Gérant 1 : ${gerant1.name} (${gerant1.phone})`);
  console.log(`   Gérant 2 : ${gerant2.name} (${gerant2.phone})`);
  console.log(`   Groupe   : ${groupe.name} (code: ${groupe.inviteCode})`);
}

main()
  .catch((e) => {
    console.error('❌ Erreur de seeding :', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
