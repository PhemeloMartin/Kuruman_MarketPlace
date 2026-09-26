import "dotenv/config";
import { app } from "./app";
import { startExpiryTimer } from "./lib/expiry";
import { startRetentionTimer } from "./lib/retention";

const PORT = Number(process.env.PORT) || 4000;

app.listen(PORT, () => {
  console.log(`KurumanMarketPlace API running on http://localhost:${PORT}`);
  startExpiryTimer();
  startRetentionTimer();
});
