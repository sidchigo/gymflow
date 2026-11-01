/**
 * @file scripts/telegram-polling.ts
 * @description Local Telegram Bot Polling Runner for Development.
 *
 * Runs locally without needing ngrok, public HTTPS tunnels, or domain setup.
 * Uses getUpdates long-polling to route Telegram messages directly into GymFlow's Agent Engine.
 */

import fs from "fs";
import path from "path";

// 1. Load .env.local variables
const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const match = line.match(/^\s*([^#=]+)\s*=\s*(.*)\s*$/);
    if (match) {
      const key = match[1]!.trim();
      let value = match[2]!.trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.substring(1, value.length - 1);
      }
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token || token.includes("REPLACE_WITH")) {
  console.error("❌ ERROR: TELEGRAM_BOT_TOKEN is missing or not set in .env.local");
  process.exit(1);
}

const TELEGRAM_API = `https://api.telegram.org/bot${token}`;

async function main() {
  const { handleTelegramIncomingMessage } = await import("../src/lib/telegram-service");
  console.log("🤖 Initializing GymFlow Telegram Bot (Local Polling Mode)...");

  // Verify bot identity
  try {
    const meRes = await fetch(`${TELEGRAM_API}/getMe`);
    const meData = (await meRes.json()) as any;
    if (!meData.ok) {
      console.error("❌ Failed to authenticate with Telegram:", meData);
      process.exit(1);
    }
    console.log(`✅ Connected as @${meData.result.username} (${meData.result.first_name})`);
  } catch (err) {
    console.error("❌ Network error connecting to Telegram:", err);
    process.exit(1);
  }

  // Clear existing webhook if set so getUpdates works
  try {
    await fetch(`${TELEGRAM_API}/deleteWebhook?drop_pending_updates=true`);
    console.log("📡 Cleared webhooks. Listening for incoming messages...");
  } catch (err) {
    console.warn("⚠️ Could not clear webhook:", err);
  }

  console.log("\n💬 Open Telegram, search for your bot, and send /start or /today or text any question!\n");

  let offset = 0;

  // Long-polling loop
  while (true) {
    try {
      const res = await fetch(`${TELEGRAM_API}/getUpdates?offset=${offset}&timeout=30`, {
        signal: AbortSignal.timeout(35000),
      });

      if (!res.ok) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      const data = (await res.json()) as any;
      if (data.ok && Array.isArray(data.result)) {
        for (const update of data.result) {
          offset = update.update_id + 1;
          if (update.message) {
            const userText = update.message.text || "[Non-text]";
            const fromUser = update.message.from?.first_name || "User";
            console.log(`📩 [${fromUser}]: ${userText}`);

            try {
              const result = await handleTelegramIncomingMessage(update);
              console.log(`   ↳ Processed: ${result}`);
            } catch (err) {
              console.error("   ↳ Error processing message:", err);
            }
          }
        }
      }
    } catch {
      // Timeout or transient network error; continue polling
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

main().catch(console.error);
