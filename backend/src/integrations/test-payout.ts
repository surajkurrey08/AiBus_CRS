import * as M from "../models/index.js";
import type { Config } from "../config/env.js";
import { testFinance } from "../services/agency-finance.service.js";
// An isolated deterministic simulator, not a bank adapter. No client status or
// transfer reference can create verified evidence. Same intent always resolves
// to the same durable provider record even after timeout/restart.
export const testPayout = {
  async submit(config: Config, intent: any) {
    testFinance(config);
    const prior = await M.TestPayoutRecord.findOne({
      intentId: intent._id,
    }).lean();
    if (prior) return prior;
    try {
      return await M.TestPayoutRecord.create({
        operatorId: intent.operatorId,
        intentId: intent._id,
        reference: `test_payout_${intent._id}`,
        amountPaise: intent.amountPaise,
        currency: "INR",
        status: "processed",
      });
    } catch (e) {
      if ((e as any).code !== 11000) throw e;
      return M.TestPayoutRecord.findOne({ intentId: intent._id }).lean();
    }
  },
  async status(config: Config, intentId: string) {
    testFinance(config);
    return M.TestPayoutRecord.findOne({ intentId }).lean();
  },
};
