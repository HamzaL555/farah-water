const { PrismaClient, Role } = require('@prisma/client');
const p = new PrismaClient();
p.user.findUnique({ where: { username: 'worker' }, select: { id: true, role: true, isActive: true, workerType: true } }).then(u => {
  console.log('Worker:', JSON.stringify(u));
  console.log('Role.WORKER:', Role.WORKER);
  console.log('Match:', u.role === Role.WORKER);
  return p.$disconnect();
}).catch(e => { console.error(e); return p.$disconnect(); });
