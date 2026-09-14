import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../services/password';

async function main() {
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (!email || !password || password.length < 12) {
    throw new Error('ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD (12+ characters) must both be set.');
  }

  const prisma = new PrismaClient();
  try {
    const existing = await prisma.adminUser.findUnique({ where: { email } });
    if (existing) {
      console.log('Administrator already exists; no changes were made.');
      return;
    }
    await prisma.adminUser.create({
      data: { email, passwordHash: await hashPassword(password), role: 'OWNER' }
    });
    console.log('Administrator created. Remove ADMIN_BOOTSTRAP_PASSWORD from the environment file now.');
  } finally {
    await prisma.$disconnect();
  }
}

void main();
