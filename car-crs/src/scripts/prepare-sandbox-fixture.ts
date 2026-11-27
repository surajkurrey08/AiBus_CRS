import { readCarSandboxConfig } from "../config/env.js";
import { connectCarCrsDatabase, disconnectCarCrsDatabase } from "../database/connection.js";
import { prepareDemoInventory } from "./demo-inventory.js";
const config = readCarSandboxConfig();
await connectCarCrsDatabase(config.CAR_CRS_MONGODB_URI);
try { console.log(JSON.stringify(await prepareDemoInventory())); }
finally { await disconnectCarCrsDatabase(); }
