import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { money, revenue } from "../../data/demo-data.ts";

export function RevenueChart({
  weekly = false,
  points = revenue,
}: {
  weekly?: boolean;
  points?: typeof revenue;
}) {
  return (
    <div className="revenue-chart">
      <ResponsiveContainer width="100%" height={235}>
        <AreaChart
          data={weekly ? points.slice(-7) : points}
          margin={{ top: 10, right: 8, left: -12, bottom: 0 }}
        >
          <defs>
            <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#146c74" stopOpacity={0.16} />
              <stop offset="100%" stopColor="#146c74" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 4"
            vertical={false}
            stroke="#e9eef0"
          />
          <XAxis
            dataKey="day"
            axisLine={false}
            tickLine={false}
            fontSize={10}
            tick={{ fill: "#86949d" }}
            minTickGap={28}
          />
          <YAxis
            tickFormatter={(v) => `₹${v / 1000}k`}
            axisLine={false}
            tickLine={false}
            fontSize={10}
            tick={{ fill: "#86949d" }}
            domain={[0, 100000]}
            ticks={[0, 25000, 50000, 75000, 100000]}
          />
          <Tooltip
            formatter={(v) => money(Number(v))}
            contentStyle={{
              borderRadius: 8,
              border: "1px solid #e8edf0",
              fontSize: 12,
            }}
          />
          <Area
            type="monotone"
            dataKey="previous"
            stroke="#bccbd0"
            strokeDasharray="5 5"
            fill="none"
            strokeWidth={1.5}
          />
          <Area
            type="monotone"
            dataKey="revenue"
            stroke="#146c74"
            fill="url(#revenueFill)"
            strokeWidth={2.5}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
