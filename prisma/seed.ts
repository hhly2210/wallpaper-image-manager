import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Start seeding...');

  // You can add seed data here if needed
  // For example:
  // const session = await prisma.session.create({
  //   data: {
  //     id: 'sample-session-id',
  //     shop: 'sample-shop.myshopify.com',
  //     state: 'active',
  //     accessToken: 'sample-access-token',
  //   },
  // });
  // console.log('Created session:', session);

  console.log('Seeding finished.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });