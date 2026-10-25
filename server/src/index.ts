import "dotenv/config";
import { app } from "./app";
import { startExpiryTimer } from "./lib/expiry";
import { startRetentionTimer } from "./lib/retention";
import { startNotificationWorker } from "./lib/notificationWorker";
import { runMigrations } from "./lib/migrate";
import { startAiWorker } from "./lib/aiWorker";
import { describeError } from "./lib/describeError";

const PORT = Number(process.env.PORT) || 4000;

// Update the database first (new tables or columns), then start taking requests.
runMigrations()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`KurumanMarketPlace API running on http://localhost:${PORT}`);
      startExpiryTimer();
      startRetentionTimer();
      startNotificationWorker();
      startAiWorker();
    });
  })
  .catch((err) => {
    console.error("Could not update the database:", describeError(err));
    process.exit(1);
  });
