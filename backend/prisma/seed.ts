/* eslint-disable no-console */
import { PrismaClient, Role, Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

function env(key: string, fallback?: string): string | undefined {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

/**
 * Creates the single bootstrap administrator.
 *
 * There is deliberately NO public registration endpoint in the API, so this
 * script is the only way an admin account is ever created.
 */
async function createAdmin(): Promise<void> {
  const username = (env('INITIAL_ADMIN_USERNAME', 'admin') as string).toLowerCase();
  const password = env('INITIAL_ADMIN_PASSWORD') as string | undefined;
  const fullName = env('INITIAL_ADMIN_FULL_NAME', 'Farah Su Şirkəti Admin') as string;
  const phone = env('INITIAL_ADMIN_PHONE') || null;

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    console.log(`[seed] Admin hesabı artıq mövcuddur: "${username}" (heç nə dəyişdirilmədi).`);
    return;
  }

  if (!password) {
    console.error('[seed] INITIAL_ADMIN_PASSWORD təyin edilməyib. Admin hesabı yaradılmadı.');
    console.error('        .env faylında INITIAL_ADMIN_PASSWORD=qüvvəli-şifrə daxil edin və "npm run seed" icra edin.');
    process.exitCode = 1;
    return;
  }

  if (password.length < 8) {
    console.error('[seed] INITIAL_ADMIN_PASSWORD ən azı 8 simvol olmalıdır.');
    process.exitCode = 1;
    return;
  }

  const rounds = Number(env('BCRYPT_ROUNDS', '12'));

  const admin = await prisma.user.create({
    data: {
      fullName,
      username,
      phone,
      passwordHash: await bcrypt.hash(password, rounds),
      role: Role.ADMIN,
      isActive: true,
      mustChangePassword: true,
    },
  });

  console.log('');
  console.log('  ============================================================');
  console.log('   FARAH SU ŞİRKƏTİ - ilkin administrator hesabı yaradıldı');
  console.log('  ============================================================');
  console.log(`   İstifadəçi adı : ${admin.username}`);
  console.log(`   Şifrə          : ${password}`);
  console.log('   İlk girişdə şifrəni dəyişmək tələb olunacaq.');
  console.log('  ============================================================');
  console.log('');
}

/** The warehouse balance row must exist so stock totals are readable from day one. */
async function ensureWarehouse(): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO inventory_balances ("key", scope, "workerId", quantity, "updatedAt")
    VALUES ('WAREHOUSE', 'WAREHOUSE'::"BalanceScope", NULL, 0, NOW())
    ON CONFLICT ("key") DO NOTHING
  `;
  console.log('[seed] Anbar qalığı qeydi hazırdır.');
}

async function seedSettings(): Promise<void> {
  const defaults: Record<string, unknown> = {
    companyName: 'Farah Su Şirkəti',
    currency: env('CURRENCY', 'AZN') as string,
    defaultBottlePrice: env('DEFAULT_BOTTLE_PRICE', '2.00') as string,
    dateFormat: 'DD.MM.YYYY',
    timezoneOffsetMinutes: 240,
  };
  for (const [key, value] of Object.entries(defaults)) {
    await prisma.appSetting.upsert({
      where: { key },
      update: {},
      create: { key, value: { value } as Prisma.InputJsonValue },
    });
  }
  console.log('[seed] Sistem parametrləri yazıldı.');
}

async function main(): Promise<void> {
  await ensureWarehouse();
  await seedSettings();
  await createAdmin();
}

main()
  .catch((err) => {
    console.error('[seed] xəta:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
