import mongoose, { Schema } from "mongoose";

export interface IDailyAgentSettlement extends mongoose.Document {
  operatorId: string;
  agentId: mongoose.Types.ObjectId;
  agentName: string;
  date: string; // "YYYY-MM-DD"
  totalBookings: number;
  grossPaise: number;
  commissionPaise: number;
  netPayablePaise: number;
  status: "Pending" | "Cleared";
  clearedAt?: Date;
  clearedByUserId?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const dailyAgentSettlementSchema = new Schema(
  {
    operatorId: { type: String, required: true, index: true },
    agentId: { type: Schema.Types.ObjectId, ref: "SalesPartner", required: true, index: true },
    agentName: { type: String, required: true },
    date: { type: String, required: true, index: true }, // "YYYY-MM-DD"
    totalBookings: { type: Number, default: 0 },
    grossPaise: { type: Number, default: 0 },
    commissionPaise: { type: Number, default: 0 },
    netPayablePaise: { type: Number, default: 0 },
    status: { type: String, enum: ["Pending", "Cleared"], default: "Pending", index: true },
    clearedAt: { type: Date },
    clearedByUserId: { type: String },
    notes: { type: String },
    reportOnly: { type: Boolean, default: true },
  },
  { timestamps: true },
);

dailyAgentSettlementSchema.index({ operatorId: 1, agentId: 1, date: 1 }, { unique: true });

export const DailyAgentSettlement = mongoose.model<IDailyAgentSettlement>(
  "DailyAgentSettlement",
  dailyAgentSettlementSchema,
);
