import { useId } from "react";

export function CarBlueprint({ isMuv }: { isMuv: boolean }) {
  const id = useId();
  return (
    <svg
      className="car-blueprint-svg"
      viewBox={isMuv ? "0 0 340 515" : "0 0 340 425"}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        {/* Subtle Technical CAD Grid */}
        <pattern id={id + "-grid"} width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#f1f5f9" strokeWidth="0.8" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id}-grid)`} />

      {/* 1. TECHNICAL CHASSIS SILHOUETTE */}
      {isMuv ? (
        <path
          d="M 120 18
             C 145 15, 195 15, 220 18
             C 246 22, 268 34, 276 56
             C 282 72, 285 92, 285 118
             C 285 140, 282 210, 280 310
             C 278 350, 285 384, 288 422
             C 290 448, 284 474, 268 492
             C 250 508, 215 512, 170 512
             C 125 512, 90 508, 72 492
             C 56 474, 50 448, 52 422
             C 55 384, 62 350, 60 310
             C 58 210, 55 140, 55 118
             C 55 92, 58 72, 64 56
             C 72 34, 94 22, 120 18 Z"
          fill="#ffffff"
          stroke="#334155"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      ) : (
        <path
          d="M 120 18
             C 145 15, 195 15, 220 18
             C 246 22, 268 34, 276 56
             C 282 72, 285 92, 285 118
             C 285 140, 282 178, 280 220
             C 278 262, 285 296, 288 332
             C 290 358, 284 384, 268 402
             C 250 418, 215 422, 170 422
             C 125 422, 90 418, 72 402
             C 56 384, 50 358, 52 332
             C 55 296, 62 262, 60 220
             C 58 178, 55 140, 55 118
             C 55 92, 58 72, 64 56
             C 72 34, 94 22, 120 18 Z"
          fill="#ffffff"
          stroke="#334155"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      )}

      {/* Front Lower Bumper Inset */}
      <path d="M 130 22 C 148 20, 192 20, 210 22 C 205 26, 135 26, 130 22 Z" stroke="#64748b" strokeWidth="1" fill="#f8fafc" />

      {/* 2. RECESSED CAD HEADLIGHT CONTOURS */}
      {/* Left Headlight */}
      <path
        d="M 72 48
           C 78 36, 95 30, 108 26
           C 107 38, 98 56, 88 64
           C 78 60, 73 54, 72 48 Z"
        stroke="#475569"
        strokeWidth="1.2"
        fill="#f8fafc"
      />
      <circle cx="86" cy="46" r="3" stroke="#64748b" strokeWidth="1" fill="none" />
      <path d="M 76 45 C 88 38, 102 33, 106 31" stroke="#38bdf8" strokeWidth="1.2" strokeLinecap="round" />

      {/* Right Headlight */}
      <path
        d="M 268 48
           C 262 36, 245 30, 232 26
           C 233 38, 242 56, 252 64
           C 262 60, 267 54, 268 48 Z"
        stroke="#475569"
        strokeWidth="1.2"
        fill="#f8fafc"
      />
      <circle cx="254" cy="46" r="3" stroke="#64748b" strokeWidth="1" fill="none" />
      <path d="M 264 45 C 252 38, 238 33, 234 31" stroke="#38bdf8" strokeWidth="1.2" strokeLinecap="round" />

      {/* 3. HOOD CHARACTER LINES */}
      <line x1="170" y1="28" x2="170" y2="108" stroke="#cbd5e1" strokeWidth="1" strokeDasharray="3 3" />
      <path d="M 124 28 C 130 56, 126 86, 112 114" stroke="#94a3b8" strokeWidth="1" strokeLinecap="round" />
      <path d="M 216 28 C 210 56, 214 86, 228 114" stroke="#94a3b8" strokeWidth="1" strokeLinecap="round" />

      {/* 4. AERODYNAMIC SIDE WING MIRRORS */}
      {/* Left Mirror */}
      <path
        d="M 55 125 L 38 122 C 32 121, 29 126, 31 131 C 33 135, 40 136, 48 134 L 55 132 Z"
        stroke="#334155"
        strokeWidth="1.4"
        fill="#ffffff"
        strokeLinejoin="round"
      />
      <line x1="33" y1="125" x2="45" y2="133" stroke="#94a3b8" strokeWidth="1" />
      {/* Right Mirror */}
      <path
        d="M 285 125 L 302 122 C 308 121, 311 126, 309 131 C 307 135, 300 136, 292 134 L 285 132 Z"
        stroke="#334155"
        strokeWidth="1.4"
        fill="#ffffff"
        strokeLinejoin="round"
      />
      <line x1="307" y1="125" x2="295" y2="133" stroke="#94a3b8" strokeWidth="1" />

      {/* 5. FRONT WINDSHIELD, DASHBOARD & STEERING WHEEL */}
      <path d="M 68 118 C 112 104, 228 104, 272 118 L 264 154 C 220 146, 120 146, 76 154 Z" stroke="#64748b" strokeWidth="1.4" fill="#f8fafc" />
      {/* Driver Cockpit Steering Wheel (RHD - Right Hand Drive Indian Standard) */}
      <circle cx="223" cy="142" r="9" stroke="#64748b" strokeWidth="1.4" fill="#ffffff" />
      <circle cx="223" cy="142" r="3" stroke="#94a3b8" strokeWidth="1" fill="#e2e8f0" />
      <line x1="223" y1="133" x2="223" y2="139" stroke="#64748b" strokeWidth="1.2" />
      <line x1="214" y1="142" x2="220" y2="142" stroke="#64748b" strokeWidth="1.2" />
      <line x1="226" y1="142" x2="232" y2="142" stroke="#64748b" strokeWidth="1.2" />
      {/* Windshield Wipers */}
      <line x1="108" y1="146" x2="142" y2="128" stroke="#475569" strokeWidth="1.4" strokeLinecap="round" />
      <line x1="178" y1="146" x2="212" y2="128" stroke="#475569" strokeWidth="1.4" strokeLinecap="round" />

      {/* 7. CABIN GREENHOUSE (SIDE WINDOWS & B-PILLARS) */}
      {/* Left Front Window */}
      <path d="M 59 160 L 56 226 L 68 223 L 71 160 Z" fill="#eaf1f7" stroke="#64748b" strokeWidth="1" />
      {/* Right Front Window */}
      <path d="M 281 160 L 284 226 L 272 223 L 269 160 Z" fill="#eaf1f7" stroke="#64748b" strokeWidth="1" />
      {/* B-Pillars */}
      <rect x="54" y="226" width="14" height="6" fill="#1e293b" rx="1" />
      <rect x="272" y="226" width="14" height="6" fill="#1e293b" rx="1" />

      {isMuv ? (
        <>
          {/* MUV Middle Windows */}
          <path d="M 56 232 L 54 316 L 66 313 L 68 232 Z" fill="#eaf1f7" stroke="#64748b" strokeWidth="1" />
          <path d="M 284 232 L 286 316 L 274 313 L 272 232 Z" fill="#eaf1f7" stroke="#64748b" strokeWidth="1" />
          {/* C-Pillars */}
          <rect x="53" y="316" width="14" height="6" fill="#1e293b" rx="1" />
          <rect x="273" y="316" width="14" height="6" fill="#1e293b" rx="1" />
          {/* MUV Rear Quarter Windows */}
          <path d="M 54 322 L 59 416 L 70 412 L 67 322 Z" fill="#eaf1f7" stroke="#64748b" strokeWidth="1" />
          <path d="M 286 322 L 281 416 L 270 412 L 273 322 Z" fill="#eaf1f7" stroke="#64748b" strokeWidth="1" />
          {/* MUV Rear Windshield */}
          <path
            d="M 74 420 C 118 428, 222 428, 266 420 L 254 456 C 218 462, 122 462, 86 456 Z"
            fill="#eaf1f7"
            stroke="#334155"
            strokeWidth="1.6"
          />
          <line x1="88" y1="432" x2="252" y2="432" stroke="#e2e8f0" strokeWidth="0.6" strokeOpacity="0.5" />
          <line x1="94" y1="442" x2="246" y2="442" stroke="#e2e8f0" strokeWidth="0.6" strokeOpacity="0.5" />
          <line x1="152" y1="424" x2="188" y2="424" stroke="#ef4444" strokeWidth="1.8" strokeLinecap="round" />
          {/* MUV Trunk & Continuous LED Taillight Bar */}
          <path d="M 104 472 C 136 476, 204 476, 236 472" stroke="#94a3b8" strokeWidth="1.2" strokeLinecap="round" />
          <path
            d="M 64 472
               C 68 486, 92 496, 120 498
               L 220 498
               C 248 496, 272 486, 276 472
               C 264 476, 240 482, 220 482
               L 120 482
               C 100 482, 76 476, 64 472 Z"
            fill="#fee2e2"
            stroke="#b91c1c"
            strokeWidth="1.2"
          />
          {/* MUV Dual Exhaust Accents */}
          <rect x="96" y="506" width="16" height="5" rx="2" fill="#334155" stroke="#64748b" strokeWidth="0.8" />
          <rect x="228" y="506" width="16" height="5" rx="2" fill="#334155" stroke="#64748b" strokeWidth="0.8" />
        </>
      ) : (
        <>
          {/* Sedan Rear Window */}
          <path d="M 56 232 L 60 326 L 71 322 L 68 232 Z" fill="#eaf1f7" stroke="#64748b" strokeWidth="1" />
          <path d="M 284 232 L 280 326 L 269 322 L 272 232 Z" fill="#eaf1f7" stroke="#64748b" strokeWidth="1" />
          {/* Sedan Rear Windshield */}
          <path
            d="M 74 330 C 118 338, 222 338, 266 330 L 254 366 C 218 372, 122 372, 86 366 Z"
            fill="#eaf1f7"
            stroke="#334155"
            strokeWidth="1.6"
          />
          <line x1="88" y1="342" x2="252" y2="342" stroke="#e2e8f0" strokeWidth="0.6" strokeOpacity="0.5" />
          <line x1="94" y1="352" x2="246" y2="352" stroke="#e2e8f0" strokeWidth="0.6" strokeOpacity="0.5" />
          <line x1="152" y1="334" x2="188" y2="334" stroke="#ef4444" strokeWidth="1.8" strokeLinecap="round" />
          {/* Sedan Trunk & Continuous LED Taillight Bar */}
          <path d="M 104 382 C 136 386, 204 386, 236 382" stroke="#94a3b8" strokeWidth="1.2" strokeLinecap="round" />
          <path
            d="M 64 382
               C 68 396, 92 406, 120 408
               L 220 408
               C 248 406, 272 396, 276 382
               C 264 386, 240 392, 220 392
               L 120 392
               C 100 392, 76 386, 64 382 Z"
            fill="#fee2e2"
            stroke="#b91c1c"
            strokeWidth="1.2"
          />
          {/* Sedan Dual Exhaust Accents */}
          <rect x="96" y="416" width="16" height="5" rx="2" fill="#334155" stroke="#64748b" strokeWidth="0.8" />
          <rect x="228" y="416" width="16" height="5" rx="2" fill="#334155" stroke="#64748b" strokeWidth="0.8" />
        </>
      )}
    </svg>
  );
}
