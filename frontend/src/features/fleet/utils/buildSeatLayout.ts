export function buildSeatLayout(
  capacity: number,
  layoutType: string,
  decks: number,
) {
  const upperCount = decks === 2 ? Math.floor(capacity / 2) : 0;
  const lowerCount = capacity - upperCount;
  return Array.from({ length: capacity }, (_, i) => {
    const upper = i >= lowerCount;
    const position = upper ? i - lowerCount : i;
    const category =
      layoutType === "mixed" ? (upper ? "sleeper" : "seater") : layoutType;
    const columns = category === "seater" ? 4 : 3;
    return {
      number: `${upper ? "U" : "L"}${position + 1}`,
      deck: upper ? "upper" : "lower",
      row: Math.floor(position / columns),
      column: (position % columns) + (position % columns >= 2 ? 1 : 0),
      category,
      farePaise: 0,
    };
  });
}
