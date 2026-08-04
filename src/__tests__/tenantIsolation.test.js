// Test du cœur de la sécurité de l'app : un gérant (tenant) ne doit JAMAIS
// pouvoir lire ou modifier les données d'un autre tenant, même en devinant
// un ID de groupe/cotisation valide appartenant à quelqu'un d'autre (IDOR).
//
// Prisma est mocké : on ne teste pas la base de données ici, on teste que
// le CODE construit bien ses requêtes avec un filtre tenantId, et qu'il
// renvoie 404/403 quand la ressource n'appartient pas au tenant courant —
// pas 200 avec les données d'un autre tenant.

jest.mock('../config/database', () => ({
  group: { findFirst: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  contribution: { findUnique: jest.fn(), update: jest.fn() },
  auditLog: { create: jest.fn() },
}));

const prisma = require('../config/database');
const groupController = require('../controllers/groupController');
const contributionController = require('../controllers/contributionController');

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

describe('Isolation multi-tenant — Groupes', () => {
  afterEach(() => jest.clearAllMocks());

  test('getGroup : un groupe d\'un AUTRE tenant doit renvoyer 404, jamais les données', async () => {
    // Le contrôleur filtre par tenantId dans la requête Prisma elle-même :
    // simuler fidèlement Prisma → un `findFirst` avec un tenantId qui ne
    // correspond à aucune ligne renvoie null, peu importe que le groupe
    // existe pour un AUTRE tenant.
    prisma.group.findFirst.mockResolvedValue(null);

    const req = {
      params: { id: 'group-appartenant-a-tenant-B' },
      tenant: { id: 'tenant-A', name: 'Gérant A' },
    };
    const res = mockRes();

    await groupController.getGroup(req, res);

    // Vérifie que la requête a bien été scopée par tenantId (pas juste par id)
    expect(prisma.group.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'group-appartenant-a-tenant-B', tenantId: 'tenant-A' }),
      })
    );
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  test('getGroup : un groupe du BON tenant est bien renvoyé', async () => {
    const fakeGroup = {
      id: 'group-1', tenantId: 'tenant-A', name: 'Tontine du bureau',
      maxMembers: null, groupMembers: [], turns: [], _count: { groupMembers: 2 },
    };
    prisma.group.findFirst.mockResolvedValue(fakeGroup);

    const req = { params: { id: 'group-1' }, tenant: { id: 'tenant-A' } };
    const res = mockRes();

    await groupController.getGroup(req, res);

    expect(res.status).not.toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ id: 'group-1' }),
      })
    );
  });

  test('updateGroup : impossible de modifier le groupe d\'un autre tenant', async () => {
    prisma.group.findFirst.mockResolvedValue(null); // scopé par tenantId, ne trouve rien

    const req = {
      params: { id: 'group-de-tenant-B' },
      body: { name: 'Nom modifié par un attaquant' },
      tenant: { id: 'tenant-A', name: 'Gérant A' },
    };
    const res = mockRes();

    await groupController.updateGroup(req, res);

    expect(prisma.group.update).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('Isolation multi-tenant — Cotisations', () => {
  afterEach(() => jest.clearAllMocks());

  test('markContributionReceived : rejette une cotisation appartenant à un autre tenant (403)', async () => {
    // Ici le contrôleur charge D'ABORD par id (sans filtre tenant dans la
    // requête), puis vérifie explicitement `contribution.group.tenantId`.
    // On simule donc une cotisation existante mais appartenant à tenant-B.
    prisma.contribution.findUnique.mockResolvedValue({
      id: 'contrib-1',
      groupId: 'group-de-B',
      group: { tenantId: 'tenant-B' },
    });

    const req = {
      params: { id: 'contrib-1' },
      body: { note: 'tentative malveillante' },
      tenant: { id: 'tenant-A', name: 'Attaquant' },
    };
    const res = mockRes();

    await contributionController.markContributionReceived(req, res);

    expect(prisma.contribution.update).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  test('markContributionReceived : autorise le bon tenant à modifier sa propre cotisation', async () => {
    prisma.contribution.findUnique.mockResolvedValue({
      id: 'contrib-1',
      groupId: 'group-1',
      group: { tenantId: 'tenant-A' },
    });
    prisma.contribution.update.mockResolvedValue({
      id: 'contrib-1', status: 'RECEIVED', user: { name: 'Membre X' }, amount: 5000, roundNumber: 1,
    });

    const req = {
      params: { id: 'contrib-1' },
      body: { note: 'ok' },
      tenant: { id: 'tenant-A', name: 'Gérant A' },
    };
    const res = mockRes();

    await contributionController.markContributionReceived(req, res);

    expect(prisma.contribution.update).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(403);
  });
});
