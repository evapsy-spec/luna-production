/**
 * Добавляет/обновляет человека в bot_users — без этого бот отвечает
 * "не узнаю" и не может написать первым (Telegram не разрешает).
 *
 * Порядок: человек пишет боту /start → бот присылает его telegram id →
 * Константин запускает эту команду с этим id.
 *
 * Запуск:
 *   npm run bot:add-user -- 123456789 "Наталья" --no-money
 *   npm run bot:add-user -- 987654321 "Ольга"
 *   npm run bot:add-user -- 111111111 "Константин" --confirm-money
 *
 * Флаги: --no-money (seesMoney=false, сейчас только для Натальи),
 *        --confirm-money (canConfirmMoney=true, сейчас только Константин и Ева).
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db/client";

async function main() {
  const [telegramUserId, name, ...flags] = process.argv.slice(2);
  if (!telegramUserId || !name) {
    console.error('Формат: tsx scripts/bot-add-user.ts <telegram_id> "<Имя>" [--no-money] [--confirm-money]');
    process.exit(1);
  }

  const seesMoney = !flags.includes("--no-money");
  const canConfirmMoney = flags.includes("--confirm-money");

  const existing = await db
    .select()
    .from(schema.botUsers)
    .where(eq(schema.botUsers.telegramUserId, telegramUserId))
    .limit(1);

  if (existing[0]) {
    await db
      .update(schema.botUsers)
      .set({ name, seesMoney, canConfirmMoney, isActive: true })
      .where(eq(schema.botUsers.telegramUserId, telegramUserId));
    console.log(`Обновлено: ${name} (${telegramUserId}), деньги: ${seesMoney}, подтверждение: ${canConfirmMoney}`);
  } else {
    await db.insert(schema.botUsers).values({ telegramUserId, name, seesMoney, canConfirmMoney });
    console.log(`Добавлено: ${name} (${telegramUserId}), деньги: ${seesMoney}, подтверждение: ${canConfirmMoney}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

