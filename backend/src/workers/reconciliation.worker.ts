import mongoose from "mongoose";
import { readConfig } from "../config/env.js";
import { runOperationalJobs } from "../jobs/operational.jobs.js";
const config = readConfig();
await mongoose.connect(config.MONGODB_URI, { autoIndex: false, autoCreate: false });
try {
 const results = await runOperationalJobs(config);
 console.log(JSON.stringify({ jobs: results }));
 if (results.some(r => r.succeeded === false)) process.exitCode = 1;
} finally { await mongoose.disconnect(); }
