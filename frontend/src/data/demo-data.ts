export type Row = Record<string, string>;
export const routeNames = [
  "Hyderabad → Bangalore",
  "Bangalore → Chennai",
  "Hyderabad → Pune",
  "Chennai → Coimbatore",
];
const names = [
  "Aarav Sharma",
  "Priya Patel",
  "Rohan Mehta",
  "Ananya Reddy",
  "Vikram Singh",
  "Sneha Iyer",
  "Arjun Nair",
  "Kavya Rao",
  "Aditya Joshi",
  "Meera Shah",
  "Rahul Desai",
  "Ishita Gupta",
];
export const bookings: Row[] = names.map((name, i) => ({
  id: `AB${240810 + i}`,
  pnr: `AIB${683420 + i}`,
  passenger: name,
  phone: `+91 98${76543210 + i}`,
  route: routeNames[i % 4],
  bus: `Aibus ${i % 2 ? "Comfort" : "Premium"}`,
  date: "2026-11-13",
  seat: `${i % 2 ? "U" : "L"}${i + 1}`,
  fare: String([1450, 1250, 1800, 950][i % 4]),
  status: i === 4 ? "Pending" : i === 8 ? "Cancelled" : "Confirmed",
  boarding: ["Gachibowli", "Silk Board", "Miyapur", "Koyambedu"][i % 4],
  checkin: i % 3 ? "Awaiting" : "Checked in",
}));
export const fleet: Row[] = Array.from({ length: 8 }, (_, i) => ({
  id: `TS 09 ${["FG", "EH", "JK", "LM"][i % 4]} ${1245 + i * 103}`,
  name: `Aibus ${["Premium", "Comfort", "Elite", "Express"][i % 4]}`,
  type: i % 3 ? "AC Sleeper (2+1)" : "AC Seater (2+2)",
  capacity: i % 3 ? "36" : "44",
  route: routeNames[i % 4],
  status: i === 5 ? "Inactive" : "Active",
}));
export const routes: Row[] = routeNames.map((route, i) => ({
  id: `RT-10${i + 1}`,
  route,
  boarding: [
    "Gachibowli, Miyapur",
    "Silk Board, Electronic City",
    "Miyapur, BHEL",
    "Koyambedu, Porur",
  ][i],
  dropping: [
    "Hebbal, Majestic",
    "Koyambedu",
    "Wakad, Hinjewadi",
    "Gandhipuram",
  ][i],
  departure: ["21:30", "22:00", "19:45", "23:15"][i],
  arrival: ["06:30", "05:30", "07:15", "06:15"][i],
  duration: ["9h 00m", "7h 30m", "11h 30m", "7h 00m"][i],
  status: "Active",
}));
export const fares: Row[] = routeNames.map((route, i) => ({
  id: `FR-10${i}`,
  route,
  weekday: String([1450, 1250, 1800, 950][i]),
  weekend: String([1650, 1450, 2100, 1100][i]),
  single: String([1650, 1450, 2000, 1150][i]),
  singleWeekend: String([1850, 1650, 2300, 1300][i]),
  festival: String([1950, 1750, 2400, 1350][i]),
  discount: "5%",
  status: "Active",
}));
export const offers: Row[] = [
  {
    id: "FIRSTBUS",
    name: "A warmer welcome",
    discount: "15%",
    period: "13 Nov – 30 Nov 2026",
    used: "248",
    status: "Active",
  },
  {
    id: "WEEKEND10",
    name: "Weekend getaways",
    discount: "10%",
    period: "01 Nov – 30 Nov 2026",
    used: "186",
    status: "Active",
  },
  {
    id: "FESTIVE20",
    name: "The festive journey",
    discount: "20%",
    period: "01 Dec – 15 Dec 2026",
    used: "0",
    status: "Scheduled",
  },
];
export const refunds: Row[] = [
  {
    id: "RF-2084",
    passenger: "Meera Shah",
    route: routeNames[0],
    amount: "1305",
    date: "13 Nov 2026",
    status: "Requested",
  },
  {
    id: "RF-2083",
    passenger: "Nikhil Kumar",
    route: routeNames[1],
    amount: "1125",
    date: "12 Nov 2026",
    status: "Refunded",
  },
];
export const revenue = Array.from({ length: 14 }, (_, i) => ({
  day: `${i + 1} Nov`,
  revenue: [38, 46, 41, 58, 48, 64, 54, 72, 62, 79, 68, 85, 75, 91][i] * 1000,
  previous: [30, 37, 33, 44, 39, 48, 43, 55, 48, 61, 53, 64, 59, 70][i] * 1000,
}));
export const money = (v: string | number) =>
  "₹" + Number(v).toLocaleString("en-IN");
